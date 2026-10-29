import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { MembershipsRepository } from './../src/memberships/memberships.repository.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  claims,
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Sifre-12345';

/** Per-request membership check (auth_version): spec "Oturum geçersizleştirme". */
describe('session revocation (e2e)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = { a: `rv-a-${run}`, b: `rv-b-${run}` };
  const tenant = { a: '', b: '' };

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = (email: string) =>
    http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200)
      .then(
        (r) => r.body.data as { accessToken: string; refreshToken: string },
      );

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

  const member = async (
    label: string,
    memberships: { tenantId: string; role: string }[],
  ) => {
    const email = `${label}-${run}@test.local`;
    const userId = await seedMember({
      email,
      name: label,
      passwordHash: await hash(PASSWORD),
      memberships: await Promise.all(
        memberships.map(async (m) => ({
          tenantId: m.tenantId,
          roleId: await systemRoleId(m.tenantId, m.role),
        })),
      ),
      lastTenantId: memberships[0].tenantId,
    });
    return { email, userId };
  };

  beforeAll(async () => {
    app = await createTestApp();
    for (const key of ['a', 'b'] as const) {
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `İptal ${key}`,
          tenantSlug: slugs[key],
          name: `Sahip ${key}`,
          email: `rv-owner-${key}-${run}@test.local`,
          password: PASSWORD,
        })
        .expect(201);
      tenant[key] = claims(res.body.data.accessToken).tid;
    }
  });

  afterAll(async () => {
    await purgeTenants([slugs.a, slugs.b]);
    await app.close();
  });

  it('a deactivated membership is rejected on the next request', async () => {
    const { email, userId } = await member('deact', [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const session = await login(email);
    await http()
      .get('/api/v1/companies')
      .set(bearer(session.accessToken))
      .expect(200);

    await sql(
      `UPDATE tenant_memberships
       SET status = 'inactive', deactivated_at = now(), auth_version = auth_version + 1
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenant.a, userId],
    );
    const res = await http()
      .get('/api/v1/companies')
      .set(bearer(session.accessToken))
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
    expect(res.body.data).toBeUndefined();
  });

  it('a deactivated membership without a version bump is still revoked', async () => {
    const { email, userId } = await member('deact-nobump', [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const session = await login(email);
    await sql(
      `UPDATE tenant_memberships SET status = 'inactive', deactivated_at = now()
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenant.a, userId],
    );
    const res = await http()
      .get('/api/v1/auth/me')
      .set(bearer(session.accessToken))
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });

  it('a stale token version gets TOKEN_STALE and refresh yields the new perms', async () => {
    const { email, userId } = await member('demote', [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const session = await login(email);
    expect(claims(session.accessToken).perms).toContain('companies:write');

    // Take the store role away and bump the version, as a role change does.
    await sql('DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2', [
      tenant.a,
      userId,
    ]);
    const repo = app.get(MembershipsRepository);
    const prisma = app.get<TenantPrismaClient>(PRISMA);
    await TenantContext.run(tenant.a, () =>
      prisma.$transaction((tx) => repo.bumpAuthVersion(tx, tenant.a, userId)),
    );

    const stale = await http()
      .post('/api/v1/companies')
      .set(bearer(session.accessToken))
      .send({})
      .expect(401);
    expect(stale.body.error.code).toBe('TOKEN_STALE');

    // Role change keeps the refresh token: the session survives.
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    const next = refreshed.body.data.accessToken as string;
    expect(claims(next)).toMatchObject({ ver: 2 });
    expect(claims(next).perms).not.toContain('companies:write');
    await http().get('/api/v1/auth/me').set(bearer(next)).expect(200);
    await http()
      .post('/api/v1/companies')
      .set(bearer(next))
      .send({})
      .expect(403);
  });

  it('bumpAuthVersion increments only the given membership', async () => {
    const { userId } = await member('bump', [
      { tenantId: tenant.a, role: 'admin' },
      { tenantId: tenant.b, role: 'admin' },
    ]);
    const repo = app.get(MembershipsRepository);
    const prisma = app.get<TenantPrismaClient>(PRISMA);
    await TenantContext.run(tenant.a, () =>
      prisma.$transaction((tx) => repo.bumpAuthVersion(tx, tenant.a, userId)),
    );
    const rows = await sql<{ tenant_id: string; auth_version: number }>(
      'SELECT tenant_id, auth_version FROM tenant_memberships WHERE user_id = $1',
      [userId],
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.tenant_id, r.auth_version])),
    ).toEqual({ [tenant.a]: 2, [tenant.b]: 1 });
  });

  it('an inactive tenant revokes its sessions on the next request', async () => {
    const slug = `rv-closing-${run}`;
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Kapanacak',
        tenantSlug: slug,
        name: 'Sahip',
        email: `rv-closing-${run}@test.local`,
        password: PASSWORD,
      })
      .expect(201);
    try {
      const token = res.body.data.accessToken as string;
      await sql('UPDATE tenants SET is_active = false WHERE id = $1', [
        claims(token).tid,
      ]);
      const denied = await http()
        .get('/api/v1/auth/me')
        .set(bearer(token))
        .expect(401);
      expect(denied.body.error.code).toBe('SESSION_REVOKED');
    } finally {
      await purgeTenants([slug]);
    }
  });

  it('a token without a membership in its tenant is SESSION_REVOKED', async () => {
    const { userId } = await member('nomember', [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const token = await app
      .get(JwtService)
      .signAsync({ sub: userId, tid: tenant.b, perms: ['*'], ver: 1 });
    const res = await http()
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });

  it('a pre-membership token without ver is TOKEN_STALE', async () => {
    const { userId } = await member('legacy', [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const token = await app
      .get(JwtService)
      .signAsync({ sub: userId, tid: tenant.a, perms: ['*'] });
    const res = await http()
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_STALE');
  });

  it('deactivation in one tenant leaves sessions in other tenants working', async () => {
    const { email, userId } = await member('multi', [
      { tenantId: tenant.a, role: 'admin' },
      { tenantId: tenant.b, role: 'admin' },
    ]);
    await sql('UPDATE users SET last_tenant_id = $2 WHERE id = $1', [
      userId,
      tenant.b,
    ]);
    const inB = await login(email);
    expect(claims(inB.accessToken).tid).toBe(tenant.b);
    await sql(
      `UPDATE tenant_memberships
       SET status = 'inactive', deactivated_at = now(), auth_version = auth_version + 1
       WHERE tenant_id = $1 AND user_id = $2`,
      [tenant.a, userId],
    );
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(inB.accessToken))
      .expect(200);
  });

  it("switching store invalidates the old store's access token", async () => {
    const { email, userId } = await member('switch', [
      { tenantId: tenant.a, role: 'admin' },
      { tenantId: tenant.b, role: 'admin' },
    ]);
    const inA = await login(email);
    expect(claims(inA.accessToken).tid).toBe(tenant.a);
    const switched = await http()
      .post('/api/v1/auth/switch-tenant')
      .set(bearer(inA.accessToken))
      .send({ tenantId: tenant.b, refreshToken: inA.refreshToken })
      .expect(200);

    const old = await http()
      .get('/api/v1/auth/me')
      .set(bearer(inA.accessToken))
      .expect(401);
    expect(old.body.error.code).toBe('TOKEN_STALE');
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(switched.body.data.accessToken))
      .expect(200);
    const rows = await sql<{ tenant_id: string; auth_version: number }>(
      'SELECT tenant_id, auth_version FROM tenant_memberships WHERE user_id = $1',
      [userId],
    );
    expect(
      Object.fromEntries(rows.map((r) => [r.tenant_id, r.auth_version])),
    ).toEqual({ [tenant.a]: 2, [tenant.b]: 1 });
  });

  it('public routes do not consult memberships', async () => {
    await http().get('/api/v1/health').expect(200);
  });
});
