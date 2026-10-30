import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import { TenantViolationError } from './../src/tenancy/tenant.errors.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

/**
 * USR-T14: privilege escalation and tenant isolation across the user
 * management endpoints (users, invitations, access, deactivate) and auth.
 * Spec "Yetki yükseltme testleri"; each item is its own test.
 */

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
const COMPANY_ROLES = ['operations', 'accounting', 'viewer'] as const;

interface Session {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

describe('Privilege escalation and tenant isolation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const slugs = [`pe-a-${run}`, `pe-b-${run}`];
  let ownerA: Session;
  let ownerB: Session;
  let tenantA: string;
  let tenantB: string;
  let companyA: string;
  let companyB: string;
  let label = 0;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const session = async (
    email: string,
    tokens: { accessToken: string; refreshToken: string },
  ): Promise<Session> => {
    const me = await http()
      .get('/api/v1/auth/me')
      .set(bearer(tokens.accessToken))
      .expect(200);
    return { userId: me.body.data.id, email, ...tokens };
  };

  const register = async (slug: string) => {
    const email = `${slug}@test.local`;
    const res = await http()
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Mağaza ${slug}`,
        tenantSlug: slug,
        name: 'Sahip',
        email,
        password: PASSWORD,
      })
      .expect(201);
    return session(email, res.body.data);
  };

  const login = async (email: string) => {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return session(email, res.body.data);
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

  /** A member of `tenantId` with a tenant role or company roles in `companies`. */
  const member = async (
    tenantId: string,
    role: Role,
    companies: string[] = [],
    extra: { tenantId: string; status?: 'active' | 'inactive' }[] = [],
  ): Promise<Session> => {
    const email = `pe-${role}-${label++}-${run}@test.local`;
    const roleId = await systemRoleId(tenantId, role);
    const tenantScoped = role === 'owner' || role === 'admin';
    const userId = await seedMember({
      email,
      name: `${role} ${label}`,
      passwordHash: await hash(PASSWORD),
      lastTenantId: tenantId,
      memberships: [
        { tenantId, ...(tenantScoped ? { roleId } : {}) },
        ...extra,
      ],
    });
    if (!tenantScoped && companies.length > 0) {
      const pool = ownerPool();
      try {
        for (const companyId of companies) {
          await pool.query(
            `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, userId, companyId, roleId],
          );
        }
      } finally {
        await pool.end();
      }
    }
    return login(email);
  };

  /** A 422 from the ValidationPipe that names `field` (not some other field error). */
  const expectFieldError = (res: request.Response, field: string) => {
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain(field);
  };

  const createInvitation = async (
    token: string,
    email: string,
    companyId: string,
  ) =>
    (
      await http()
        .post('/api/v1/invitations')
        .set(bearer(token))
        .send({ email, companyRoles: [{ companyId, roleKey: 'viewer' }] })
        .expect(201)
    ).body.data.id as string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PRISMA);
    ownerA = await register(slugs[0]);
    ownerB = await register(slugs[1]);
    tenantA = (
      await http().get('/api/v1/auth/me').set(bearer(ownerA.accessToken))
    ).body.data.tenantId;
    tenantB = (
      await http().get('/api/v1/auth/me').set(bearer(ownerB.accessToken))
    ).body.data.tenantId;
    companyA = await createCompany(ownerA.accessToken, `A ${run}`);
    companyB = await createCompany(ownerB.accessToken, `B ${run}`);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('company role cannot call users or invitations endpoints (403)', async () => {
    const target = await member(tenantA, 'viewer', [companyA]);
    const invitationId = await createInvitation(
      ownerA.accessToken,
      `pe-pending-${run}@test.local`,
      companyA,
    );
    for (const role of COMPANY_ROLES) {
      const s = await member(tenantA, role, [companyA]);
      const calls = [
        () => http().get('/api/v1/users'),
        () =>
          http()
            .put(`/api/v1/users/${target.userId}/access`)
            .send({
              companyRoles: [{ companyId: companyA, roleKey: 'operations' }],
            }),
        () => http().post(`/api/v1/users/${target.userId}/deactivate`),
        () => http().post(`/api/v1/users/${target.userId}/activate`),
        () => http().get('/api/v1/invitations'),
        () =>
          http()
            .post('/api/v1/invitations')
            .send({
              email: `pe-x-${role}-${run}@test.local`,
              companyRoles: [{ companyId: companyA, roleKey: 'viewer' }],
            }),
        () => http().post(`/api/v1/invitations/${invitationId}/resend`),
        () => http().post(`/api/v1/invitations/${invitationId}/revoke`),
      ];
      for (const call of calls) {
        const res = await call().set(bearer(s.accessToken));
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
      }
    }
  });

  it('admin cannot grant admin or owner; nobody grants owner', async () => {
    const admin = await member(tenantA, 'admin');
    const ops = await member(tenantA, 'operations', [companyA]);
    const viaAccess = await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(admin.accessToken))
      .send({ tenantRole: 'admin' })
      .expect(403);
    expect(viaAccess.body.error.code).toBe('ROLE_NOT_GRANTABLE');
    const viaInvite = await http()
      .post('/api/v1/invitations')
      .set(bearer(admin.accessToken))
      .send({ email: `pe-adm-${run}@test.local`, tenantRole: 'admin' })
      .expect(403);
    expect(viaInvite.body.error.code).toBe('ROLE_NOT_GRANTABLE');
    for (const actor of [admin, ownerA]) {
      await http()
        .put(`/api/v1/users/${ops.userId}/access`)
        .set(bearer(actor.accessToken))
        .send({ tenantRole: 'owner' })
        .expect(422)
        .expect((r) => expectFieldError(r, 'tenantRole'));
      await http()
        .post('/api/v1/invitations')
        .set(bearer(actor.accessToken))
        .send({
          email: `pe-own-${label++}-${run}@test.local`,
          tenantRole: 'owner',
        })
        .expect(422)
        .expect((r) => expectFieldError(r, 'tenantRole'));
      await http()
        .put(`/api/v1/users/${ops.userId}/access`)
        .set(bearer(actor.accessToken))
        .send({ companyRoles: [{ companyId: companyA, roleKey: 'owner' }] })
        .expect(422)
        .expect((r) => expectFieldError(r, 'roleKey'));
    }
    // Unknown fields are refused, not ignored.
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(ownerA.accessToken))
      .send({
        companyRoles: [{ companyId: companyA, roleKey: 'viewer' }],
        permissions: ['*'],
      })
      .expect(422)
      .expect((r) => expectFieldError(r, 'permissions'));
  });

  it('nobody can edit their own access', async () => {
    const admin = await member(tenantA, 'admin');
    for (const s of [ownerA, admin]) {
      for (const call of [
        () =>
          http()
            .put(`/api/v1/users/${s.userId}/access`)
            .send({
              companyRoles: [{ companyId: companyA, roleKey: 'viewer' }],
            }),
        () => http().post(`/api/v1/users/${s.userId}/deactivate`),
      ]) {
        const res = await call().set(bearer(s.accessToken)).expect(403);
        expect(res.body.error.code).toBe('SELF_CHANGE');
      }
    }
  });

  it('foreign tenant company, user or invitation ids are 404', async () => {
    const ops = await member(tenantA, 'operations', [companyA]);
    const opsB = await member(tenantB, 'operations', [companyB]);
    const invitationB = await createInvitation(
      ownerB.accessToken,
      `pe-inv-b-${run}@test.local`,
      companyB,
    );
    await http()
      .post('/api/v1/invitations')
      .set(bearer(ownerA.accessToken))
      .send({
        email: `pe-foreign-${run}@test.local`,
        companyRoles: [{ companyId: companyB, roleKey: 'viewer' }],
      })
      .expect(404);
    await http()
      .put(`/api/v1/users/${ops.userId}/access`)
      .set(bearer(ownerA.accessToken))
      .send({ companyRoles: [{ companyId: companyB, roleKey: 'viewer' }] })
      .expect(404);
    for (const call of [
      () =>
        http()
          .put(`/api/v1/users/${opsB.userId}/access`)
          .send({ companyRoles: [{ companyId: companyA, roleKey: 'viewer' }] }),
      () => http().post(`/api/v1/users/${opsB.userId}/deactivate`),
      () => http().post(`/api/v1/users/${ownerB.userId}/activate`),
      () => http().post(`/api/v1/invitations/${invitationB}/revoke`),
      () => http().post(`/api/v1/invitations/${invitationB}/resend`),
      () => http().get(`/api/v1/companies/${companyB}`),
    ]) {
      await call().set(bearer(ownerA.accessToken)).expect(404);
    }
    // Nothing changed in tenant B.
    const stillB = await http()
      .get('/api/v1/invitations')
      .set(bearer(ownerB.accessToken))
      .expect(200);
    expect(stillB.body.data.map((i: { id: string }) => i.id)).toContain(
      invitationB,
    );
    await http()
      .get('/api/v1/auth/me')
      .set(bearer(opsB.accessToken))
      .expect(200);
  });

  it('old token after role removal cannot write; refreshed token has the new rights only', async () => {
    const admin = await member(tenantA, 'admin');
    await http()
      .get('/api/v1/users')
      .set(bearer(admin.accessToken))
      .expect(200);
    await http()
      .put(`/api/v1/users/${admin.userId}/access`)
      .set(bearer(ownerA.accessToken))
      .send({ companyRoles: [{ companyId: companyA, roleKey: 'viewer' }] })
      .expect(200);
    for (const call of [
      () => http().get('/api/v1/users'),
      () =>
        http()
          .post('/api/v1/invitations')
          .send({
            email: `pe-stale-${run}@test.local`,
            companyRoles: [{ companyId: companyA, roleKey: 'viewer' }],
          }),
      () =>
        http().patch(`/api/v1/companies/${companyA}`).send({ city: 'Ankara' }),
    ]) {
      const res = await call().set(bearer(admin.accessToken));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_STALE');
    }
    const refreshed = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: admin.refreshToken })
      .expect(200);
    const token = refreshed.body.data.accessToken as string;
    await http().get('/api/v1/users').set(bearer(token)).expect(403);
    await http()
      .patch(`/api/v1/companies/${companyA}`)
      .set(bearer(token))
      .send({ city: 'Ankara' })
      .expect(403);
    await http()
      .get(`/api/v1/companies/${companyA}`)
      .set(bearer(token))
      .expect(200);
  });

  it('inactive membership cannot switch-tenant (404)', async () => {
    // Active in A, inactive in B.
    const s = await member(
      tenantA,
      'viewer',
      [companyA],
      [{ tenantId: tenantB, status: 'inactive' }],
    );
    const res = await http()
      .post('/api/v1/auth/switch-tenant')
      .set(bearer(s.accessToken))
      .send({ tenantId: tenantB, refreshToken: s.refreshToken })
      .expect(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
    // The current session still works.
    await http().get('/api/v1/auth/me').set(bearer(s.accessToken)).expect(200);
    // Deactivated through the API in A: switching back to A is refused as well.
    const both = await member(
      tenantB,
      'viewer',
      [companyB],
      [{ tenantId: tenantA }],
    );
    await http()
      .post(`/api/v1/users/${both.userId}/deactivate`)
      .set(bearer(ownerA.accessToken))
      .expect(200);
    const back = await http()
      .post('/api/v1/auth/switch-tenant')
      .set(bearer(both.accessToken))
      .send({ tenantId: tenantA, refreshToken: both.refreshToken })
      .expect(404);
    expect(back.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it("tenant B cannot read A's users, invitations or memberships", async () => {
    const opsA = await member(tenantA, 'operations', [companyA]);
    const invitationA = await createInvitation(
      ownerA.accessToken,
      `pe-inv-a-${run}@test.local`,
      companyA,
    );
    const users = await http()
      .get('/api/v1/users')
      .set(bearer(ownerB.accessToken))
      .expect(200);
    const ids = users.body.data.map((u: { userId: string }) => u.userId);
    expect(ids).not.toContain(opsA.userId);
    expect(ids).not.toContain(ownerA.userId);
    expect(JSON.stringify(users.body)).not.toContain(ownerA.email);
    expect(JSON.stringify(users.body)).not.toContain(opsA.email);
    const invitations = await http()
      .get('/api/v1/invitations')
      .set(bearer(ownerB.accessToken))
      .expect(200);
    expect(
      invitations.body.data.map((i: { id: string }) => i.id),
    ).not.toContain(invitationA);
    await http()
      .post(`/api/v1/invitations/${invitationA}/revoke`)
      .set(bearer(ownerB.accessToken))
      .expect(404);
    await http()
      .post(`/api/v1/users/${opsA.userId}/deactivate`)
      .set(bearer(ownerB.accessToken))
      .expect(404);
    const memberships = await http()
      .get('/api/v1/auth/memberships')
      .set(bearer(ownerB.accessToken))
      .expect(200);
    expect(
      memberships.body.data.map((m: { tenantId: string }) => m.tenantId),
    ).toEqual([tenantB]);
  });

  it('User model is unreachable from tenant context (TenantViolationError)', async () => {
    await expect(
      TenantContext.run(tenantA, () => prisma.user.findMany({ take: 1 })),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      TenantContext.run(tenantA, () =>
        prisma.user.update({
          where: { id: ownerB.userId },
          data: { name: 'x' },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);
    // Not through a nested write either (a valid Prisma call; only the extension refuses it).
    await expect(
      TenantContext.run(tenantA, () =>
        prisma.tenantMembership.update({
          where: {
            tenantId_userId: { tenantId: tenantA, userId: ownerA.userId },
          },
          data: { user: { update: { name: 'x' } } },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('deactivation ends the access token (SESSION_REVOKED) and the refresh token', async () => {
    const s = await member(tenantA, 'operations', [companyA]);
    await http()
      .post(`/api/v1/users/${s.userId}/deactivate`)
      .set(bearer(ownerA.accessToken))
      .expect(200);
    const next = await http()
      .get(`/api/v1/companies/${companyA}`)
      .set(bearer(s.accessToken));
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe('SESSION_REVOKED');
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('INVALID_REFRESH_TOKEN'));
    await http()
      .post('/api/v1/auth/login')
      .send({ email: s.email, password: PASSWORD })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe('INVALID_CREDENTIALS'));
  });

  it('a forged or foreign-tenant JWT is refused', async () => {
    const jwt = app.get(JwtService, { strict: false });
    const claims = jwt.decode<Record<string, unknown>>(ownerA.accessToken);
    const { iat: _iat, exp: _exp, ...payload } = claims;
    // Signed with another key.
    const forged = new JwtService({ secret: 'x'.repeat(48) }).sign(payload);
    await http().get('/api/v1/users').set(bearer(forged)).expect(401);
    // Correctly signed, but for a tenant where the user has no membership.
    const foreign = jwt.sign({ ...payload, tid: tenantB });
    const res = await http().get('/api/v1/users').set(bearer(foreign));
    expect(res.status).toBe(401);
    // Refused by the membership check, not by token verification.
    expect(res.body.error.code).toBe('SESSION_REVOKED');
    expect(JSON.stringify(res.body)).not.toContain(ownerB.email);
  });

  it('a member of two tenants is shown per tenant: no roles from the other tenant', async () => {
    const both = await member(
      tenantA,
      'operations',
      [companyA],
      [{ tenantId: tenantB }],
    );
    const pool = ownerPool();
    try {
      await pool.query(
        `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantB, both.userId, companyB, await systemRoleId(tenantB, 'viewer')],
      );
    } finally {
      await pool.end();
    }
    await http()
      .post(`/api/v1/users/${both.userId}/deactivate`)
      .set(bearer(ownerA.accessToken))
      .expect(200);
    const fromB = await http()
      .get('/api/v1/users')
      .set(bearer(ownerB.accessToken))
      .expect(200);
    const row = fromB.body.data.find(
      (u: { userId: string }) => u.userId === both.userId,
    );
    expect(row).toMatchObject({
      status: 'active',
      access: { companyRoles: [{ companyId: companyB, roleKey: 'viewer' }] },
    });
    expect(JSON.stringify(row)).not.toContain(companyA);
  });

  it('audit:read is denied to every company role', async () => {
    for (const role of COMPANY_ROLES) {
      const s = await member(tenantA, role, [companyA]);
      await http()
        .get('/api/v1/audit-logs')
        .set(bearer(s.accessToken))
        .expect(403);
      await http()
        .get(`/api/v1/audit-logs/${randomUUID()}`)
        .set(bearer(s.accessToken))
        .expect(403);
    }
    await http()
      .get('/api/v1/audit-logs')
      .set(bearer(ownerA.accessToken))
      .expect(200);
  });
}, 30_000); // Many argon2 hashes and logins per test.
