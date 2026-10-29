import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  claims,
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Sifre-12345';

const DISABLE = {
  inactive: 'UPDATE users SET is_active = false WHERE id = $1',
  deleted: 'UPDATE users SET deleted_at = now() WHERE id = $1',
} as const;
type Disabled = keyof typeof DISABLE;

/** Globally deactivated or soft-deleted users get no tokens (login, refresh). */
describe('inactive / deleted users (e2e)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slug = `iu-${run}`;
  let tenantId = '';
  let adminRole = '';

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/refresh').send({ refreshToken });

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

  const member = async (label: string) => {
    const email = `${label}-${run}@test.local`;
    const userId = await seedMember({
      email,
      name: label,
      passwordHash: await hash(PASSWORD),
      memberships: [{ tenantId, roleId: adminRole }],
      lastTenantId: tenantId,
    });
    return { email, userId };
  };

  /** The failed-login audit row may be written in the background: poll briefly. */
  const loginFailed = async (userId: string) => {
    for (let i = 0; i < 50; i++) {
      const rows = await sql<{
        tenant_id: string;
        after: unknown;
        actor_user_id: string | null;
      }>(
        `SELECT tenant_id, after, actor_user_id FROM audit_logs
         WHERE entity_id = $1 AND action = 'LOGIN_FAILED'`,
        [userId],
      );
      if (rows.length > 0) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [];
  };

  const reuseRows = (userId: string) =>
    sql(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'TOKEN_REUSE_DETECTED'`,
      [userId],
    );

  beforeAll(async () => {
    app = await createTestApp();
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Pasif Kullanıcı ${run}`,
        tenantSlug: slug,
        name: 'Sahip',
        email: `iu-owner-${run}@test.local`,
        password: PASSWORD,
      })
      .expect(201);
    tenantId = claims(res.body.data.accessToken).tid;
    adminRole = await systemRoleId(tenantId, 'admin');
  });

  afterAll(async () => {
    await purgeTenants([slug, `iu-reg-${run}`]);
    await app.close();
  });

  describe.each(['inactive', 'deleted'] as Disabled[])('%s user', (state) => {
    it('login returns the wrong-password error and no tokens', async () => {
      const { email, userId } = await member(`login-${state}`);
      const wrong = await login(email, 'Yanlis-12345').expect(401);
      await sql(DISABLE[state], [userId]);

      const res = await login(email).expect(401);
      expect(res.body.data).toBeUndefined();
      expect(res.body).toEqual(wrong.body);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      const unknown = await login(`nobody-${run}@test.local`).expect(401);
      expect(res.body).toEqual(unknown.body);
    });

    it('failed login is audited with a reason code only', async () => {
      const { email, userId } = await member(`audit-${state}`);
      await sql(DISABLE[state], [userId]);
      await login(email).expect(401);

      const rows = await loginFailed(userId);
      expect(rows).toEqual([
        {
          tenant_id: tenantId,
          after: { reason: `user_${state}` },
          actor_user_id: null,
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain(PASSWORD);
      expect(JSON.stringify(rows)).not.toContain(email);
    });

    it('refresh returns the bad-token error, revokes the token, no reuse alarm', async () => {
      const { email, userId } = await member(`refresh-${state}`);
      const session = (await login(email).expect(200)).body.data;
      const bad = await refresh('x'.repeat(64)).expect(401);
      await sql(DISABLE[state], [userId]);

      const res = await refresh(session.refreshToken).expect(401);
      expect(res.body.data).toBeUndefined();
      expect(res.body).toEqual(bad.body);
      expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');

      const tokens = await sql<{ revoked: boolean }>(
        'SELECT revoked_at IS NOT NULL AS revoked FROM refresh_tokens WHERE user_id = $1',
        [userId],
      );
      expect(tokens).toEqual([{ revoked: true }]);

      // A second attempt with the same (now revoked) token is not theft.
      const again = await refresh(session.refreshToken).expect(401);
      expect(again.body).toEqual(bad.body);
      expect(await reuseRows(userId)).toEqual([]);
      const count = await sql<{ n: number }>(
        'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1',
        [userId],
      );
      expect(count).toEqual([{ n: 1 }]);
    });

    it('switch-tenant is refused (the access token is revoked)', async () => {
      const { email, userId } = await member(`switch-${state}`);
      const session = (await login(email).expect(200)).body.data;
      await sql(DISABLE[state], [userId]);
      const res = await http()
        .post('/api/v1/auth/switch-tenant')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ tenantId: randomUUID(), refreshToken: session.refreshToken })
        .expect(401);
      expect(res.body.error.code).toBe('SESSION_REVOKED');
      expect(res.body.data).toBeUndefined();
    });
  });

  it('active users still log in and refresh', async () => {
    const { email } = await member('active');
    const session = (await login(email).expect(200)).body.data;
    const next = (await refresh(session.refreshToken).expect(200)).body.data;
    await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${next.accessToken}`)
      .expect(200);
  });

  it('register with the email of a deleted user does not issue tokens', async () => {
    const { email, userId } = await member('reg-deleted');
    await sql(DISABLE.deleted, [userId]);
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Tekrar Kayıt',
        tenantSlug: `iu-reg-${run}`,
        name: 'Tekrar',
        email,
        password: PASSWORD,
      })
      .expect(409);
    expect(res.body.data).toBeUndefined();
  });
});
