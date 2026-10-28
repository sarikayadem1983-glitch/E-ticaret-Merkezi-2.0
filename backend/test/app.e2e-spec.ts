import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditService } from './../src/audit/audit.service.js';
import { isValidVkn } from './../src/companies/tax-number.js';
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

let vknSeq = 0;
/** A unique valid VKN (adds the check digit). */
function validVkn(): string {
  const prefix =
    String(Date.now() % 1e6).padStart(6, '0') +
    String(vknSeq++ % 1000).padStart(3, '0');
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) return validVkn();
  return prefix + d;
}

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

  describe('failed-login audit and token binding', () => {
    const fx = { slug: `fx-${run}`, email: `fx-owner-${run}@test.local` };
    let fxTenant: string;
    let fxAdmin: string;

    const login = (email: string, password = PASSWORD) =>
      http().post('/api/v1/auth/login').send({ email, password });

    const sql = async <T = Record<string, unknown>>(
      text: string,
      params: unknown[] = [],
    ): Promise<T[]> => {
      const pool = ownerPool();
      try {
        return (await pool.query(text, params)).rows as T[];
      } finally {
        await pool.end();
      }
    };

    /** The audit row may be written in the background: poll briefly. */
    const loginFailedRows = async (tenantId: string, userId: string) => {
      for (let i = 0; i < 50; i++) {
        const rows = await sql<{
          before: unknown;
          after: unknown;
          actor_user_id: string | null;
        }>(
          `SELECT before, after, actor_user_id FROM audit_logs
           WHERE tenant_id = $1 AND entity_id = $2 AND action = 'LOGIN_FAILED'`,
          [tenantId, userId],
        );
        if (rows.length > 0) return rows;
        await new Promise((r) => setTimeout(r, 50));
      }
      return [];
    };

    const member = async (
      label: string,
      status: 'active' | 'inactive',
      tenantId = fxTenant,
      roleId: string | null = fxAdmin,
    ) => {
      const email = `${label}-${run}@test.local`;
      const userId = await seedMember({
        email,
        name: label,
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId, roleId: roleId ?? undefined, status }],
      });
      return { email, userId };
    };

    beforeAll(async () => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Fikstür ${run}`,
          tenantSlug: fx.slug,
          name: 'Fikstür Sahip',
          email: fx.email,
          password: PASSWORD,
        })
        .expect(201);
      fxTenant = claims(res.body.data.accessToken).tid;
      fxAdmin = await systemRoleId(fxTenant, 'admin');
    });

    afterAll(() => purgeTenants([fx.slug]));

    it('failed login of a deactivated member is audited in that tenant', async () => {
      const { email, userId } = await member('deact', 'inactive');
      await login(email).expect(401);
      const rows = await loginFailedRows(fxTenant, userId);
      expect(rows).toEqual([
        {
          before: null,
          after: { reason: 'membership_inactive' },
          actor_user_id: null,
        },
      ]);
    });

    it('wrong password for a user with only inactive memberships is audited', async () => {
      const { email, userId } = await member('deact-wrong', 'inactive');
      await login(email, 'yanlis-sifre-1').expect(401);
      const rows = await loginFailedRows(fxTenant, userId);
      expect(rows.map((r) => r.after)).toEqual([
        { reason: 'invalid_password' },
      ]);
    });

    it('login into an inactive tenant is audited as tenant_inactive', async () => {
      const slug = `fx-off-${run}`;
      const t = await sql<{ id: string }>(
        `INSERT INTO tenants (id, name, slug, is_active, updated_at)
         VALUES (gen_random_uuid(), 'Kapalı', $1, false, now()) RETURNING id`,
        [slug],
      );
      try {
        const { email, userId } = await member('off', 'active', t[0].id, null);
        await login(email).expect(401);
        const rows = await loginFailedRows(t[0].id, userId);
        expect(rows.map((r) => r.after)).toEqual([
          { reason: 'tenant_inactive' },
        ]);
      } finally {
        await purgeTenants([slug]);
      }
    });

    it('response is identical to unknown email', async () => {
      const { email } = await member('same', 'inactive');
      const unknown = await login(`nobody-${run}@test.local`);
      const known = await login(email);
      const wrong = await login(email, 'yanlis-sifre-2');
      for (const res of [known, wrong]) {
        expect(res.status).toBe(unknown.status);
        expect(res.body).toEqual(unknown.body);
        expect(res.headers['content-type']).toBe(
          unknown.headers['content-type'],
        );
      }
      expect(unknown.status).toBe(401);
      expect(unknown.body).toEqual({
        error: expect.objectContaining({
          code: 'INVALID_CREDENTIALS',
          message: 'Email veya şifre hatalı',
        }),
      });
    });

    it('LOGIN_FAILED rows contain only a reason code, never credentials or secrets', async () => {
      const { email, userId } = await member('secret', 'inactive');
      const submitted = 'Gizli-Sifre-778';
      await login(email, submitted).expect(401);
      await login(email).expect(401);
      const rows = await loginFailedRows(fxTenant, userId);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const passwordHash = (
        await sql<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id = $1',
          [userId],
        )
      )[0].password_hash;
      for (const row of rows) {
        expect(row.before).toBeNull();
        expect(Object.keys(row.after as object)).toEqual(['reason']);
        const text = JSON.stringify(row);
        for (const secret of [submitted, PASSWORD, email, passwordHash]) {
          expect(text).not.toContain(secret);
        }
        expect(['invalid_password', 'membership_inactive']).toContain(
          (row.after as { reason: string }).reason,
        );
        expect(text).not.toMatch(/argon2|token|hash/i);
      }
    });

    it('an audit write failure during login does not change the response', async () => {
      const { email } = await member('auditfail', 'inactive');
      const active = await member('auditfail-active', 'active');
      const failing = await createTestApp(
        {},
        {
          providers: [
            {
              provide: AuditService,
              useValue: {
                record: () => Promise.reject(new Error('audit down')),
              },
            },
          ],
        },
      );
      try {
        const server = () => request(failing.getHttpServer());
        for (const res of [
          // Background path (no usable membership) and awaited path (wrong password).
          await server()
            .post('/api/v1/auth/login')
            .send({ email, password: PASSWORD }),
          await server()
            .post('/api/v1/auth/login')
            .send({ email: active.email, password: 'yanlis-sifre-3' }),
        ]) {
          expect(res.status).toBe(401);
          expect(res.body.error).toMatchObject({
            code: 'INVALID_CREDENTIALS',
            message: 'Email veya şifre hatalı',
          });
          expect(JSON.stringify(res.body)).not.toContain('audit down');
        }
      } finally {
        await failing.close();
      }
    });

    it('refresh with a token of a now-inactive membership returns 401 and no tokens', async () => {
      const { email, userId } = await member('refresh-deact', 'active');
      const session = (await login(email).expect(200)).body.data;
      await sql(
        `UPDATE tenant_memberships SET status = 'inactive', deactivated_at = now()
         WHERE tenant_id = $1 AND user_id = $2`,
        [fxTenant, userId],
      );
      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expect(res.body.data).toBeUndefined();
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('refresh in a tenant that is now inactive returns 401', async () => {
      const slug = `fx-closing-${run}`;
      const t = await sql<{ id: string }>(
        `INSERT INTO tenants (id, name, slug, updated_at)
         VALUES (gen_random_uuid(), 'Kapanacak', $1, now()) RETURNING id`,
        [slug],
      );
      try {
        const adminRole = await sql<{ id: string }>(
          `INSERT INTO roles (id, tenant_id, name, permissions, key, scope, is_system, updated_at)
           VALUES (gen_random_uuid(), $1, 'Admin', '{}', 'admin', 'tenant', true, now()) RETURNING id`,
          [t[0].id],
        );
        const email = `closing-${run}@test.local`;
        await seedMember({
          email,
          name: 'Kapanış',
          passwordHash: await hash(PASSWORD),
          memberships: [{ tenantId: t[0].id, roleId: adminRole[0].id }],
        });
        const session = (await login(email).expect(200)).body.data;
        await sql('UPDATE tenants SET is_active = false WHERE id = $1', [
          t[0].id,
        ]);
        const res = await http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: session.refreshToken })
          .expect(401);
        expect(res.body.data).toBeUndefined();
      } finally {
        await purgeTenants([slug]);
      }
    });

    it("an access token for tenant A cannot act on tenant B's resources", async () => {
      const company = await http()
        .post('/api/v1/companies')
        .set('Authorization', `Bearer ${tokens.b.accessToken}`)
        .send({
          legalName: `B Şirketi ${run}`,
          taxNumber: validVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
          postalCode: '34710',
        })
        .expect(201);
      const id = company.body.data.id as string;
      const asA = { Authorization: `Bearer ${tokens.a.accessToken}` };

      await http().get(`/api/v1/companies/${id}`).set(asA).expect(404);
      await http()
        .patch(`/api/v1/companies/${id}`)
        .set(asA)
        .send({ city: 'Ankara' })
        .expect(404);
      const list = await http()
        .get('/api/v1/companies?per_page=100')
        .set(asA)
        .expect(200);
      expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(id);
      // Still intact for its own tenant.
      const own = await http()
        .get(`/api/v1/companies/${id}`)
        .set('Authorization', `Bearer ${tokens.b.accessToken}`)
        .expect(200);
      expect(own.body.data.city).toBe('İstanbul');
    });
  });
});
