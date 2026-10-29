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

  it.each([
    [
      'globally deactivated',
      'UPDATE users SET is_active = false WHERE id = $1',
    ],
    ['soft-deleted', 'UPDATE users SET deleted_at = now() WHERE id = $1'],
  ])('a %s user is rejected on the next request', async (label, update) => {
    const { email, userId } = await member(`user-${label.split(' ')[0]}`, [
      { tenantId: tenant.a, role: 'admin' },
    ]);
    const session = await login(email);
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(session.accessToken))
      .expect(200);
    await sql(update, [userId]);
    const res = await http()
      .get('/api/v1/auth/me')
      .set(bearer(session.accessToken))
      .expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
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

  describe('refresh token reuse', () => {
    const refresh = (refreshToken: string) =>
      http().post('/api/v1/auth/refresh').send({ refreshToken });
    const me = (accessToken: string) =>
      http().get('/api/v1/auth/me').set(bearer(accessToken));
    const reuseAudits = (userId: string) =>
      sql<{ tenant_id: string; actor_user_id: string | null; after: unknown }>(
        `SELECT tenant_id, actor_user_id, after FROM audit_logs
         WHERE action = 'TOKEN_REUSE_DETECTED' AND entity_id = $1`,
        [userId],
      );
    const unrevoked = (userId: string) =>
      sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM refresh_tokens
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      ).then((r) => r[0].n);

    it('ends the sessions of a multi-store user in every store', async () => {
      const { email, userId } = await member('reuse-multi', [
        { tenantId: tenant.a, role: 'admin' },
        { tenantId: tenant.b, role: 'admin' },
      ]);
      // A session in A and one in B (switch bumps A, so refresh A afterwards).
      const first = await login(email);
      const toSwitch = await login(email);
      const switched = await http()
        .post('/api/v1/auth/switch-tenant')
        .set(bearer(toSwitch.accessToken))
        .send({ tenantId: tenant.b, refreshToken: toSwitch.refreshToken })
        .expect(200);
      const inB = switched.body.data as {
        accessToken: string;
        refreshToken: string;
      };
      const rotated = await refresh(first.refreshToken).expect(200);
      const inA = rotated.body.data as {
        accessToken: string;
        refreshToken: string;
      };
      expect(claims(inA.accessToken).tid).toBe(tenant.a);
      expect(claims(inB.accessToken).tid).toBe(tenant.b);
      await me(inA.accessToken).expect(200);
      await me(inB.accessToken).expect(200);
      expect(await unrevoked(userId)).toBe(2);

      // Reuse the rotated A token.
      const reuse = await refresh(first.refreshToken).expect(401);
      expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');
      // Snapshot now: presenting a revoked token below is itself a reuse and
      // writes further (zero-count) audit rows.
      const audits = await reuseAudits(userId);

      // Refresh tokens are revoked in both stores…
      await refresh(inB.refreshToken).expect(401);
      await refresh(inA.refreshToken).expect(401);
      expect(await unrevoked(userId)).toBe(0);
      // …and access tokens in both stores are refused immediately.
      const b = await me(inB.accessToken).expect(401);
      expect(b.body.error.code).toBe('TOKEN_STALE');
      const a = await me(inA.accessToken).expect(401);
      expect(a.body.error.code).toBe('TOKEN_STALE');

      const byTenant = Object.fromEntries(audits.map((r) => [r.tenant_id, r]));
      expect(audits).toHaveLength(2);
      const affected = [tenant.a, tenant.b];
      for (const [tid, count] of [
        [tenant.a, 1],
        [tenant.b, 1],
      ] as const) {
        expect(byTenant[tid].actor_user_id).toBeNull();
        expect(byTenant[tid].after).toEqual({
          detectedInTenantId: tenant.a,
          refreshRevokedCount: count,
          accessRevoked: true,
          totalRefreshRevokedCount: 2,
          affectedTenantIds: expect.arrayContaining(affected),
        });
      }
      const text = JSON.stringify(audits);
      for (const secret of [
        first.refreshToken,
        inA.refreshToken,
        inB.refreshToken,
        inA.accessToken,
        inB.accessToken,
      ]) {
        expect(text).not.toContain(secret);
      }
    });

    it('ends every session of a single-store user', async () => {
      const { email, userId } = await member('reuse-single', [
        { tenantId: tenant.a, role: 'admin' },
      ]);
      const other = await login(email);
      const first = await login(email);
      const rotated = await refresh(first.refreshToken).expect(200);
      const next = rotated.body.data as {
        accessToken: string;
        refreshToken: string;
      };

      await refresh(first.refreshToken).expect(401);
      // Snapshot before retrying revoked tokens (each retry is a reuse too).
      const audits = await reuseAudits(userId);
      await refresh(next.refreshToken).expect(401);
      await refresh(other.refreshToken).expect(401);
      for (const token of [next.accessToken, other.accessToken]) {
        const res = await me(token).expect(401);
        expect(res.body.error.code).toBe('TOKEN_STALE');
      }

      expect(audits).toHaveLength(1);
      expect(audits[0].tenant_id).toBe(tenant.a);
      expect(audits[0].after).toEqual({
        detectedInTenantId: tenant.a,
        refreshRevokedCount: 2,
        accessRevoked: true,
        totalRefreshRevokedCount: 2,
        affectedTenantIds: [tenant.a],
      });
    });

    it('concurrent refreshes leave no stored token that no client received', async () => {
      const { email, userId } = await member('racer', [
        { tenantId: tenant.a, role: 'owner' },
      ]);
      const session = await login(email);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => refresh(session.refreshToken)),
      );
      const issued = results
        .filter((r) => r.status === 200)
        .map((r) => r.body.data.refreshToken as string);
      expect(issued.length).toBeLessThanOrEqual(1);

      // Login token + one row per token handed out; a lost race adds none.
      const rows = await sql<{ n: number }>(
        'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
        [userId],
      );
      expect(rows[0].n).toBe(1 + issued.length);
      const active = await sql(
        'SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
      expect(active).toHaveLength(0);
    });
  });

  it('public routes do not consult memberships', async () => {
    await http().get('/api/v1/health').expect(200);
  });
});
