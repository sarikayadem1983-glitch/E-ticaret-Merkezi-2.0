import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}

let seq = 0;
const uniqueVkn = () =>
  vkn(
    String(Date.now() % 1e6).padStart(6, '0') + String(seq++).padStart(3, '0'),
  );

type Role = 'owner' | 'admin' | 'operations' | 'accounting' | 'viewer';

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

interface Member {
  userId: string;
  name: string;
  email: string;
  status: string;
  access:
    | { tenantRole: string }
    | {
        companyRoles: {
          companyId: string;
          companyName: string | null;
          roleKey: string;
        }[];
      };
}

describe('Users API (e2e)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`usr-a-${run}`, `usr-b-${run}`];
  let owner: Session;
  let ownerB: Session;
  let tenantA: string;
  let tenantB: string;
  let companyX: string;
  let companyY: string;
  let label = 0;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const register = async (slug: string): Promise<Session> => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Mağaza ${slug}`,
        tenantSlug: slug,
        name: 'Sahip',
        email: `${slug}@test.local`,
        password: PASSWORD,
      })
      .expect(201);
    const me = await http()
      .get('/api/v1/auth/me')
      .set(bearer(res.body.data.accessToken))
      .expect(200);
    return {
      userId: me.body.data.id ?? me.body.data.userId,
      accessToken: res.body.data.accessToken,
      refreshToken: res.body.data.refreshToken,
    };
  };

  const login = async (email: string): Promise<Session> => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const me = await http()
      .get('/api/v1/auth/me')
      .set(bearer(res.body.data.accessToken))
      .expect(200);
    return {
      userId: me.body.data.id ?? me.body.data.userId,
      accessToken: res.body.data.accessToken,
      refreshToken: res.body.data.refreshToken,
    };
  };

  const createCompany = async (token: string, legalName: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;

  /** A member of `tenantId`: a tenant role (owner/admin) or company roles. */
  const member = async (
    tenantId: string,
    role: Role,
    companyIds: string[] = [],
    extraTenants: string[] = [],
  ): Promise<Session & { email: string }> => {
    const email = `usr-${role}-${label++}-${run}@test.local`;
    const roleId = await systemRoleId(tenantId, role);
    const tenantScoped = role === 'owner' || role === 'admin';
    await seedMember({
      email,
      name: `${role} ${label}`,
      passwordHash: await hash(PASSWORD),
      lastTenantId: tenantId,
      memberships: [
        { tenantId, ...(tenantScoped ? { roleId } : {}) },
        ...extraTenants.map((t) => ({ tenantId: t })),
      ],
    });
    if (!tenantScoped) {
      const pool = ownerPool();
      try {
        const { rows } = await pool.query<{ id: string }>(
          'SELECT id FROM users WHERE email = $1',
          [email],
        );
        for (const companyId of companyIds) {
          await pool.query(
            `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, rows[0].id, companyId, roleId],
          );
        }
      } finally {
        await pool.end();
      }
    }
    return { email, ...(await login(email)) };
  };

  const companyRoleRows = async (userId: string) => {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query<{ company_id: string }>(
        'SELECT company_id FROM user_company_roles WHERE user_id = $1 AND tenant_id = $2',
        [userId, tenantA],
      );
      return rows.map((r) => r.company_id).sort();
    } finally {
      await pool.end();
    }
  };

  const auditRows = async (entityId: string) => {
    const pool = ownerPool();
    try {
      const { rows } = await pool.query<{
        action: string;
        before: unknown;
        after: unknown;
      }>(
        `SELECT action, before, after FROM audit_logs
         WHERE tenant_id = $1 AND module = 'users' AND entity_id = $2 ORDER BY created_at`,
        [tenantA, entityId],
      );
      return rows;
    } finally {
      await pool.end();
    }
  };

  const listUsers = async (token: string) =>
    (await http().get('/api/v1/users').set(bearer(token)).expect(200)).body
      .data as Member[];

  beforeAll(async () => {
    app = await createTestApp();
    owner = await register(slugs[0]);
    ownerB = await register(slugs[1]);
    tenantA = (
      await http().get('/api/v1/auth/me').set(bearer(owner.accessToken))
    ).body.data.tenantId;
    tenantB = (
      await http().get('/api/v1/auth/me').set(bearer(ownerB.accessToken))
    ).body.data.tenantId;
    companyX = await createCompany(owner.accessToken, `X ${run}`);
    companyY = await createCompany(owner.accessToken, `Y ${run}`);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('lists only members of the current tenant', async () => {
    const ops = await member(tenantA, 'operations', [companyX]);
    const outsider = await member(tenantB, 'admin');
    const users = await listUsers(owner.accessToken);
    const ids = users.map((u) => u.userId);
    expect(ids).toEqual(expect.arrayContaining([owner.userId, ops.userId]));
    expect(ids).not.toContain(outsider.userId);
    expect(ids).not.toContain(ownerB.userId);
    const row = users.find((u) => u.userId === ops.userId)!;
    expect(row).toMatchObject({
      email: ops.email,
      status: 'active',
      access: {
        companyRoles: [
          {
            companyId: companyX,
            companyName: `X ${run}`,
            roleKey: 'operations',
          },
        ],
      },
    });
    expect(users.find((u) => u.userId === owner.userId)!.access).toEqual({
      tenantRole: 'owner',
    });
    expect(JSON.stringify(users)).not.toMatch(/password|hash|token/i);
  });

  it('requires users:read to list and users:manage to change', async () => {
    const viewer = await member(tenantA, 'viewer', [companyX]);
    const ops = await member(tenantA, 'operations', [companyX]);
    await http()
      .get('/api/v1/users')
      .set(bearer(viewer.accessToken))
      .expect(403);
    await http()
      .post(`/api/v1/users/${viewer.userId}/deactivate`)
      .set(bearer(ops.accessToken))
      .expect(403);
    await http()
      .put(`/api/v1/users/${viewer.userId}/access`)
      .set(bearer(ops.accessToken))
      .send({ companyRoles: [{ companyId: companyY, roleKey: 'viewer' }] })
      .expect(403);
  });

  it('a member of another tenant is 404', async () => {
    const outsider = await member(tenantB, 'operations');
    await http()
      .put(`/api/v1/users/${outsider.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ companyRoles: [{ companyId: companyX, roleKey: 'viewer' }] })
      .expect(404);
    await http()
      .post(`/api/v1/users/${outsider.userId}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(404);
    await http()
      .post(`/api/v1/users/${ownerB.userId}/activate`)
      .set(bearer(owner.accessToken))
      .expect(404);
    await http()
      .post(`/api/v1/users/${randomUUID()}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(404);
    // Still a working session in tenant B.
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(outsider.accessToken))
      .expect(200);
  });

  it('deactivate keeps assignments and kills sessions in this tenant only', async () => {
    const ops = await member(
      tenantA,
      'operations',
      [companyX, companyY],
      [tenantB],
    );
    const res = await http()
      .post(`/api/v1/users/${ops.userId}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(res.body.data).toMatchObject({
      userId: ops.userId,
      status: 'inactive',
    });

    const next = await http()
      .get('/api/v1/auth/me')
      .set(bearer(ops.accessToken));
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe('SESSION_REVOKED');
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ops.refreshToken })
      .expect(401);
    expect(await companyRoleRows(ops.userId)).toEqual(
      [companyX, companyY].sort(),
    );

    // The same account still signs in to tenant B.
    const b = await http()
      .post('/api/v1/auth/login')
      .send({ email: ops.email, password: PASSWORD })
      .expect(200);
    const me = await http()
      .get('/api/v1/auth/me')
      .set(bearer(b.body.data.accessToken));
    expect(me.body.data.tenantId).toBe(tenantB);

    const row = (await listUsers(owner.accessToken)).find(
      (u) => u.userId === ops.userId,
    )!;
    expect(row.status).toBe('inactive');
    // Repeating it changes nothing.
    await http()
      .post(`/api/v1/users/${ops.userId}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(
      (await auditRows(ops.userId)).filter(
        (r) => r.action === 'MEMBERSHIP_DEACTIVATED',
      ),
    ).toHaveLength(1);
  });

  it('activate restores access and requires a fresh login', async () => {
    const ops = await member(tenantA, 'operations', [companyX]);
    await http()
      .post(`/api/v1/users/${ops.userId}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await http()
      .post(`/api/v1/users/${ops.userId}/activate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: ops.refreshToken })
      .expect(401);
    const fresh = await login(ops.email);
    await http()
      .get(`/api/v1/companies/${companyX}`)
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(await companyRoleRows(ops.userId)).toEqual([companyX]);
  });

  it('nobody changes their own access or deactivates themselves', async () => {
    const admin = await member(tenantA, 'admin');
    for (const s of [owner, admin]) {
      const d = await http()
        .post(`/api/v1/users/${s.userId}/deactivate`)
        .set(bearer(s.accessToken))
        .expect(403);
      expect(d.body.error.code).toBe('SELF_CHANGE');
      const p = await http()
        .put(`/api/v1/users/${s.userId}/access`)
        .set(bearer(s.accessToken))
        .send({ companyRoles: [{ companyId: companyX, roleKey: 'viewer' }] })
        .expect(403);
      expect(p.body.error.code).toBe('SELF_CHANGE');
    }
  });

  it('owner access is immutable, even for another owner', async () => {
    const owner2 = await member(tenantA, 'owner');
    const admin = await member(tenantA, 'admin');
    for (const actor of [owner, admin]) {
      const res = await http()
        .put(`/api/v1/users/${owner2.userId}/access`)
        .set(bearer(actor.accessToken))
        .send({ tenantRole: 'admin' })
        .expect(403);
      expect(res.body.error.code).toBe(
        actor === owner ? 'OWNER_IMMUTABLE' : 'ROLE_NOT_GRANTABLE',
      );
    }
    expect(
      (await listUsers(owner.accessToken)).find(
        (u) => u.userId === owner2.userId,
      )!.access,
    ).toEqual({ tenantRole: 'owner' });
  });

  it('admin cannot change an owner or another admin; only an owner grants or removes admin', async () => {
    const admin = await member(tenantA, 'admin');
    const admin2 = await member(tenantA, 'admin');
    const ops = await member(tenantA, 'operations', [companyX]);
    await http()
      .post(`/api/v1/users/${owner.userId}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(403);
    await http()
      .post(`/api/v1/users/${admin2.userId}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(403);
    await http()
      .put(`/api/v1/users/${admin2.userId}/access`)
      .set(bearer(admin.accessToken))
      .send({ companyRoles: [{ companyId: companyX, roleKey: 'viewer' }] })
      .expect(403);
    const grant = await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(admin.accessToken))
      .send({ tenantRole: 'admin' })
      .expect(403);
    expect(grant.body.error.code).toBe('ROLE_NOT_GRANTABLE');
    // Admin manages company roles.
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(admin.accessToken))
      .send({ companyRoles: [{ companyId: companyY, roleKey: 'accounting' }] })
      .expect(200);
    // Owner grants and removes admin.
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ tenantRole: 'admin' })
      .expect(200);
    await http()
      .put(`/api/v1/users/${admin2.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ companyRoles: [{ companyId: companyX, roleKey: 'operations' }] })
      .expect(200);
  });

  it('a non-last owner can be deactivated by another owner; an admin cannot touch owners', async () => {
    const slug = `usr-c-${run}`;
    slugs.push(slug);
    const solo = await register(slug);
    const tenantC = (
      await http().get('/api/v1/auth/me').set(bearer(solo.accessToken))
    ).body.data.tenantId as string;
    const owner2 = await member(tenantC, 'owner');
    await http()
      .post(`/api/v1/users/${owner2.userId}/deactivate`)
      .set(bearer(solo.accessToken))
      .expect(200);
    // owner2 is inactive now; solo is the last active owner.
    const admin = await member(tenantC, 'admin');
    await http()
      .post(`/api/v1/users/${solo.userId}/deactivate`)
      .set(bearer(admin.accessToken))
      .expect(403);
    await http()
      .post(`/api/v1/users/${owner2.userId}/activate`)
      .set(bearer(solo.accessToken))
      .expect(200);
    const o2 = await login(owner2.email);
    await http()
      .post(`/api/v1/users/${solo.userId}/deactivate`)
      .set(bearer(o2.accessToken))
      .expect(200);
    // Reactivate solo through owner2, then owner2 cannot remove the last other owner... and vice versa.
    await http()
      .post(`/api/v1/users/${solo.userId}/activate`)
      .set(bearer(o2.accessToken))
      .expect(200);
    const fresh = await login(`${slug}@test.local`);
    await http()
      .post(`/api/v1/users/${owner2.userId}/deactivate`)
      .set(bearer(fresh.accessToken))
      .expect(200);
    const last = await http()
      .post(`/api/v1/users/${owner2.userId}/activate`)
      .set(bearer(fresh.accessToken))
      .expect(200);
    expect(last.body.data.status).toBe('active');
  });

  it('concurrent deactivation of two owners leaves one active owner', async () => {
    const slug = `usr-e-${run}`;
    slugs.push(slug);
    const o1 = await register(slug);
    const tenantE = (
      await http().get('/api/v1/auth/me').set(bearer(o1.accessToken))
    ).body.data.tenantId as string;
    const o2 = await member(tenantE, 'owner');
    // Hold both owner rows locked so both requests are in flight at the same
    // time and must queue on the lock; without FOR UPDATE in the service they
    // would not wait here and could both succeed.
    const pool = ownerPool();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT 1 FROM tenant_memberships WHERE tenant_id = $1 AND user_id = ANY($2::uuid[]) FOR UPDATE`,
        [tenantE, [o1.userId, o2.userId]],
      );
      const pending = Promise.all([
        http()
          .post(`/api/v1/users/${o2.userId}/deactivate`)
          .set(bearer(o1.accessToken))
          .then((r) => r),
        http()
          .post(`/api/v1/users/${o1.userId}/deactivate`)
          .set(bearer(o2.accessToken))
          .then((r) => r),
      ]);
      // Both requests reach the lock: count only backends blocked by the holder.
      const holderPid = (
        await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      let waiting = 0;
      for (let i = 0; i < 40 && waiting < 2; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const { rows } = await pool.query<{ n: string }>(
          // Directly behind the holder, or behind a backend that is (tuple lock queue).
          `SELECT count(*) n FROM pg_stat_activity a
           WHERE $1 = ANY(pg_blocking_pids(a.pid))
              OR EXISTS (SELECT 1 FROM pg_stat_activity b
                         WHERE b.pid = ANY(pg_blocking_pids(a.pid))
                           AND $1 = ANY(pg_blocking_pids(b.pid)))`,
          [holderPid],
        );
        waiting = Number(rows[0].n);
      }
      expect(waiting).toBe(2);
      await holder.query('COMMIT');
      const results = await pending;
      const codes = results.map((r) => r.status).sort((x, y) => x - y);
      // The winner commits; the loser re-reads after the lock and sees itself inactive.
      expect(codes).toEqual([200, 403]);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) n FROM tenant_memberships m JOIN user_roles ur USING (tenant_id, user_id)
         JOIN roles r ON r.id = ur.role_id
         WHERE m.tenant_id = $1 AND m.status = 'active' AND r.key = 'owner'`,
        [tenantE],
      );
      expect(Number(rows[0].n)).toBe(1);
    } finally {
      holder.release();
      await pool.end();
    }
  }, 20_000);

  it('company roles must name active companies of this tenant', async () => {
    const ops = await member(tenantA, 'operations', [companyX]);
    const foreign = await createCompany(ownerB.accessToken, `B ${run}`);
    const inactive = await createCompany(owner.accessToken, `Pasif ${run}`);
    await http()
      .post(`/api/v1/companies/${inactive}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const put = (body: unknown) =>
      http()
        .put(`/api/v1/users/${ops.userId}/access`)
        .set(bearer(owner.accessToken))
        .send(body as object);
    expect((await put({ companyRoles: [] }).expect(400)).body.error.code).toBe(
      'COMPANY_REQUIRED',
    );
    expect((await put({}).expect(400)).body.error.code).toBe('ROLE_REQUIRED');
    expect(
      (
        await put({
          tenantRole: 'admin',
          companyRoles: [{ companyId: companyX, roleKey: 'viewer' }],
        }).expect(400)
      ).body.error.code,
    ).toBe('ROLE_REQUIRED');
    await put({
      companyRoles: [{ companyId: foreign, roleKey: 'viewer' }],
    }).expect(404);
    await put({
      companyRoles: [{ companyId: inactive, roleKey: 'viewer' }],
    }).expect(404);
    await put({
      companyRoles: [
        { companyId: companyX, roleKey: 'viewer' },
        { companyId: companyX, roleKey: 'operations' },
      ],
    }).expect(400);
    await put({
      companyRoles: [{ companyId: companyX, roleKey: 'owner' }],
    }).expect(422);
    expect(await companyRoleRows(ops.userId)).toEqual([companyX]);
  });

  it('switching from admin to company roles drops the old permissions at once', async () => {
    const admin = await member(tenantA, 'admin');
    await http()
      .get('/api/v1/users')
      .set(bearer(admin.accessToken))
      .expect(200);
    const res = await http()
      .put(`/api/v1/users/${admin.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ companyRoles: [{ companyId: companyX, roleKey: 'viewer' }] })
      .expect(200);
    expect(res.body.data.access).toEqual({
      companyRoles: [
        { companyId: companyX, companyName: `X ${run}`, roleKey: 'viewer' },
      ],
    });
    const stale = await http()
      .get('/api/v1/users')
      .set(bearer(admin.accessToken));
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('TOKEN_STALE');
    const fresh = await login(admin.email);
    await http()
      .get('/api/v1/users')
      .set(bearer(fresh.accessToken))
      .expect(403);
  });

  it('audit records before/after without secrets', async () => {
    const ops = await member(tenantA, 'operations', [companyX]);
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ companyRoles: [{ companyId: companyY, roleKey: 'accounting' }] })
      .expect(200);
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(owner.accessToken))
      .send({ tenantRole: 'admin' })
      .expect(200);
    await http()
      .post(`/api/v1/users/${ops.userId}/deactivate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    await http()
      .post(`/api/v1/users/${ops.userId}/activate`)
      .set(bearer(owner.accessToken))
      .expect(200);
    const rows = await auditRows(ops.userId);
    expect(rows.map((r) => r.action)).toEqual([
      'COMPANY_ACCESS_CHANGED',
      'ROLE_CHANGED',
      'COMPANY_ACCESS_CHANGED',
      'MEMBERSHIP_DEACTIVATED',
      'MEMBERSHIP_ACTIVATED',
    ]);
    expect(rows[0]).toMatchObject({
      before: {
        companyRoles: [{ companyId: companyX, roleKey: 'operations' }],
      },
      after: {
        companyRoles: [{ companyId: companyY, roleKey: 'accounting' }],
        added: [{ companyId: companyY, roleKey: 'accounting' }],
        removed: [{ companyId: companyX, roleKey: 'operations' }],
      },
    });
    expect(rows[1]).toMatchObject({
      before: { tenantRole: null },
      after: { tenantRole: 'admin' },
    });
    expect(rows[3]).toMatchObject({
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
    expect(JSON.stringify(rows)).not.toMatch(/password|hash|token|@/i);
  });
}, 20_000); // Many argon2 hashes and logins per test: slow on small hosts.
