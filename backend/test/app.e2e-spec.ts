import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  TenantContextMissingError,
  TenantViolationError,
} from './../src/tenancy/tenant.errors.js';
import {
  claims,
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Sifre-12345';

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const tenants = {
    a: { slug: `a-${run}`, email: `a-${run}@test.local` },
    b: { slug: `b-${run}`, email: `b-${run}@test.local` },
  };
  const tokens: Record<
    'a' | 'b',
    { accessToken: string; refreshToken: string }
  > = {} as never;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PRISMA);

    for (const key of ['a', 'b'] as const) {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${key}`,
          tenantSlug: tenants[key].slug,
          name: `Sahip ${key}`,
          email: tenants[key].email,
          password: PASSWORD,
        })
        .expect(201);
      tokens[key] = res.body.data;
    }
  });

  afterAll(async () => {
    await purgeTenants([tenants.a.slug, tenants.b.slug]);
    await app.close();
  });

  it('GET /health is public', () =>
    http()
      .get('/api/v1/health')
      .expect(200)
      .expect({ data: { status: 'ok', database: 'up' } }));

  describe('tenant isolation', () => {
    it('blocks queries with no tenant context', async () => {
      await expect(prisma.user.findMany()).rejects.toBeInstanceOf(
        TenantContextMissingError,
      );
    });

    it('refuses the global User model inside a tenant context', async () => {
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`)
        .expect(200);
      await expect(
        TenantContext.run(me.body.data.tenantId, () => prisma.user.findMany()),
      ).rejects.toBeInstanceOf(TenantViolationError);
    });

    // Users are global now; inside a tenant they are only reachable through memberships.
    it('a tenant only sees its own members, even with an empty where', async () => {
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`)
        .expect(200);
      const tenantA = me.body.data.tenantId as string;

      const members = await TenantContext.run(tenantA, () =>
        prisma.tenantMembership.findMany({
          select: { user: { select: { email: true } } },
        }),
      );
      expect(members).toEqual([{ user: { email: tenants.a.email } }]);
    });

    it("cannot read another tenant's membership by user id", async () => {
      const b = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`)
        .expect(200);
      const a = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`)
        .expect(200);

      const leaked = await TenantContext.run(a.body.data.tenantId, () =>
        prisma.tenantMembership.findFirst({
          where: { userId: b.body.data.id },
        }),
      );
      expect(leaked).toBeNull();
    });

    it("database rejects linking a role to another tenant's user", async () => {
      const a = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`);
      const b = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`);

      await expect(
        TenantContext.run(a.body.data.tenantId, async () => {
          const role = await prisma.role.findFirstOrThrow();
          return prisma.userRole.create({
            data: {
              tenantId: a.body.data.tenantId,
              userId: b.body.data.id,
              roleId: role.id,
            },
          });
        }),
      ).rejects.toThrow(/Foreign key|foreign key/);
    });
  });

  describe('auth', () => {
    it('rejects requests without a token', () =>
      http()
        .get('/api/v1/auth/me')
        .expect(401)
        .expect((res) => expect(res.body.error.code).toBe('UNAUTHORIZED')));

    it('returns 422 with field details on invalid input', () =>
      http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email' })
        .expect(422)
        .expect((res) => {
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
          expect(res.body.error.details.length).toBeGreaterThan(0);
        }));

    it('returns 409 for a duplicate email', () =>
      http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: 'Başka',
          tenantSlug: `c-${run}`,
          name: 'Başka Sahip',
          email: tenants.a.email,
          password: PASSWORD,
        })
        .expect(409));

    it('does not leave a tenant behind when registration fails', async () => {
      const orphan = await TenantContext.runAsSystem(() =>
        prisma.tenant.findUnique({ where: { slug: `c-${run}` } }),
      );
      expect(orphan).toBeNull();
    });

    it('logs in and returns owner permissions', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email.toUpperCase(), password: PASSWORD })
        .expect(200);
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`)
        .expect(200);
      expect(me.body.data).toMatchObject({
        email: tenants.a.email,
        permissions: ['*'],
      });
    });

    it('rejects a wrong password', () =>
      http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email, password: 'yanlis-sifre' })
        .expect(401)
        .expect((res) =>
          expect(res.body.error.code).toBe('INVALID_CREDENTIALS'),
        ));

    it('rotates refresh tokens and kills all sessions on reuse', async () => {
      const first = tokens.b.refreshToken;
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);
      const second = rotated.body.data.refreshToken as string;
      expect(second).not.toBe(first);

      // Reusing the old token is treated as theft…
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);
      // …so the newer token is revoked too.
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second })
        .expect(401);
    });

    it('logout revokes the refresh token', async () => {
      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email: tenants.a.email, password: PASSWORD })
        .expect(200);
      const { accessToken, refreshToken } = login.body.data;

      await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
  describe('memberships', () => {
    const login = (email: string) =>
      http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
      const meA = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.a.accessToken}`);
      const meB = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`);
      tenantA = meA.body.data.tenantId;
      tenantB = meB.body.data.tenantId;
    });

    it('login normalizes email case', async () => {
      const upper = `OWNER-${run}@Example.com`;
      await seedMember({
        email: upper.toLowerCase(),
        name: 'Büyük Harf',
        passwordHash: await hash(PASSWORD),
        memberships: [
          { tenantId: tenantA, roleId: await systemRoleId(tenantA, 'admin') },
        ],
      });
      await login(upper).expect(200);
    });

    it('register creates user, membership and five system roles', async () => {
      const pool = ownerPool();
      try {
        const roles = await pool.query<{ key: string; scope: string }>(
          'SELECT key, scope FROM roles WHERE tenant_id = $1 AND is_system ORDER BY key',
          [tenantA],
        );
        expect(roles.rows).toEqual([
          { key: 'accounting', scope: 'company' },
          { key: 'admin', scope: 'tenant' },
          { key: 'operations', scope: 'company' },
          { key: 'owner', scope: 'tenant' },
          { key: 'viewer', scope: 'company' },
        ]);
        const owner = await pool.query(
          `SELECT m.status, m.auth_version, r.key, u.last_tenant_id
           FROM tenant_memberships m
           JOIN users u ON u.id = m.user_id
           JOIN user_roles ur ON ur.tenant_id = m.tenant_id AND ur.user_id = m.user_id
           JOIN roles r ON r.id = ur.role_id
           WHERE m.tenant_id = $1 AND u.email = $2`,
          [tenantA, tenants.a.email],
        );
        expect(owner.rows).toEqual([
          {
            status: 'active',
            auth_version: 1,
            key: 'owner',
            last_tenant_id: tenantA,
          },
        ]);
      } finally {
        await pool.end();
      }
    });

    it('issues ver on register, login and refresh tokens', async () => {
      expect(claims(tokens.a.accessToken)).toMatchObject({
        tid: tenantA,
        perms: ['*'],
        ver: 1,
      });
      const res = await login(tenants.a.email).expect(200);
      expect(claims(res.body.data.accessToken).ver).toBe(1);
      const refreshed = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: res.body.data.refreshToken })
        .expect(200);
      expect(claims(refreshed.body.data.accessToken)).toMatchObject({
        tid: tenantA,
        perms: ['*'],
        ver: 1,
      });
    });

    it('login picks last_tenant_id among several memberships', async () => {
      const email = `multi-${run}@test.local`;
      const userId = await seedMember({
        email,
        name: 'İki Mağaza',
        passwordHash: await hash(PASSWORD),
        lastTenantId: tenantB,
        memberships: [
          { tenantId: tenantA, roleId: await systemRoleId(tenantA, 'admin') },
          { tenantId: tenantB, roleId: await systemRoleId(tenantB, 'admin') },
        ],
      });
      const res = await login(email).expect(200);
      expect(claims(res.body.data.accessToken)).toMatchObject({
        sub: userId,
        tid: tenantB,
        ver: 1,
      });
      expect(claims(res.body.data.accessToken).perms).toContain('users:manage');
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`)
        .expect(200);
      expect(me.body.data).toMatchObject({ id: userId, tenantId: tenantB });
    });

    it('falls back to the first membership by tenant name when last_tenant_id is not usable', async () => {
      const email = `fallback-${run}@test.local`;
      await seedMember({
        email,
        name: 'Geri Dönüş',
        passwordHash: await hash(PASSWORD),
        lastTenantId: tenantB,
        memberships: [
          { tenantId: tenantA, roleId: await systemRoleId(tenantA, 'admin') },
          {
            tenantId: tenantB,
            roleId: await systemRoleId(tenantB, 'admin'),
            status: 'inactive',
          },
        ],
      });
      const res = await login(email).expect(200);
      expect(claims(res.body.data.accessToken).tid).toBe(tenantA);
    });

    it('login with only inactive memberships returns the generic error', async () => {
      const email = `inactive-${run}@test.local`;
      await seedMember({
        email,
        name: 'Pasif',
        passwordHash: await hash(PASSWORD),
        memberships: [
          {
            tenantId: tenantA,
            roleId: await systemRoleId(tenantA, 'admin'),
            status: 'inactive',
          },
        ],
      });
      const res = await login(email).expect(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Email veya şifre hatalı',
      });
    });

    it('login with no membership at all returns the generic error', async () => {
      const email = `orphan-${run}@test.local`;
      await seedMember({
        email,
        name: 'Üyeliksiz',
        passwordHash: await hash(PASSWORD),
        memberships: [],
      });
      try {
        const res = await login(email).expect(401);
        expect(res.body.error.message).toBe('Email veya şifre hatalı');
      } finally {
        const pool = ownerPool();
        await pool.query('DELETE FROM users WHERE email = $1', [email]);
        await pool.end();
      }
    });

    it('a pre-migration owner (post-migration shape) logs in with owner permissions', async () => {
      // The shape phase 1 produces for an existing owner: users.tenant_id still set,
      // the legacy role named "owner" mapped to key owner, one membership.
      const pool = ownerPool();
      const slug = `legacy-${run}`;
      const email = `legacy-${run}@test.local`;
      try {
        const t = await pool.query<{ id: string }>(
          `INSERT INTO tenants (id, name, slug, updated_at)
           VALUES (gen_random_uuid(), 'Eski Mağaza', $1, now()) RETURNING id`,
          [slug],
        );
        const tenantId = t.rows[0].id;
        const u = await pool.query<{ id: string }>(
          `INSERT INTO users (id, tenant_id, name, email, password_hash, updated_at)
           VALUES (gen_random_uuid(), $1, 'Eski Sahip', $2, $3, now()) RETURNING id`,
          [tenantId, email, await hash(PASSWORD)],
        );
        const r = await pool.query<{ id: string }>(
          `INSERT INTO roles (id, tenant_id, name, permissions, key, scope, is_system, updated_at)
           VALUES (gen_random_uuid(), $1, 'owner', ARRAY['*'], 'owner', 'tenant', true, now()) RETURNING id`,
          [tenantId],
        );
        await pool.query(
          'INSERT INTO tenant_memberships (tenant_id, user_id, updated_at) VALUES ($1, $2, now())',
          [tenantId, u.rows[0].id],
        );
        await pool.query(
          'INSERT INTO user_roles (tenant_id, user_id, role_id, updated_at) VALUES ($1, $2, $3, now())',
          [tenantId, u.rows[0].id, r.rows[0].id],
        );

        const res = await login(email).expect(200);
        expect(claims(res.body.data.accessToken)).toMatchObject({
          sub: u.rows[0].id,
          tid: tenantId,
          perms: ['*'],
          ver: 1,
        });
        await http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: res.body.data.refreshToken })
          .expect(200);
      } finally {
        await pool.end();
        await purgeTenants([slug]);
      }
    });
  });
});
