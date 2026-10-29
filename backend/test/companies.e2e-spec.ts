import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  createTestApp,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

/** A valid VKN for a 9-digit prefix (adds the check digit). */
function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}

/** Same prefix with a wrong check digit. */
function invalidVkn(): string {
  const valid = vkn('123456789');
  return valid.slice(0, 9) + String((Number(valid[9]) + 1) % 10);
}

let seq = 0;
const uniqueVkn = () =>
  vkn(
    String(Date.now() % 1e6).padStart(6, '0') + String(seq++).padStart(3, '0'),
  );

const companyBody = (overrides: Record<string, unknown> = {}) => ({
  legalName: 'Örnek Ticaret A.Ş.',
  taxNumber: uniqueVkn(),
  taxOffice: 'Kadıköy',
  addressLine: 'Moda Cad. No: 1',
  district: 'Kadıköy',
  city: 'İstanbul',
  postalCode: '34710',
  ...overrides,
});

interface Company {
  id: string;
  legalName: string;
  taxNumber: string;
  isActive: boolean;
  city: string;
}

describe('Companies (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const slugs = [`co-a-${run}`, `co-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const register = async (slug: string) =>
    (
      await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${slug}`,
          tenantSlug: slug,
          name: 'Sahip',
          email: `${slug}@test.local`,
          password: PASSWORD,
        })
        .expect(201)
    ).body.data.accessToken as string;

  const create = async (token: string, overrides = {}) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send(companyBody(overrides))
        .expect(201)
    ).body.data as Company;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PRISMA);
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    tenantA = (await http().get('/api/v1/auth/me').set(bearer(tokenA))).body
      .data.tenantId;
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('requires authentication', async () => {
    await http().get('/api/v1/companies').expect(401);
    await http().post('/api/v1/companies').send(companyBody()).expect(401);
  });

  describe('CRUD', () => {
    it('creates, reads, updates, deactivates and reactivates a company', async () => {
      const created = await create(tokenA);
      expect(created).toMatchObject({
        legalName: 'Örnek Ticaret A.Ş.',
        isActive: true,
      });

      const got = await http()
        .get(`/api/v1/companies/${created.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(got.body.data.id).toBe(created.id);

      const updated = await http()
        .patch(`/api/v1/companies/${created.id}`)
        .set(bearer(tokenA))
        .send({ legalName: 'Yeni Unvan Ltd. Şti.', city: 'Ankara' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        legalName: 'Yeni Unvan Ltd. Şti.',
        city: 'Ankara',
        taxNumber: created.taxNumber,
      });

      const off = await http()
        .post(`/api/v1/companies/${created.id}/deactivate`)
        .set(bearer(tokenA))
        .expect(200);
      expect(off.body.data.isActive).toBe(false);

      const on = await http()
        .post(`/api/v1/companies/${created.id}/activate`)
        .set(bearer(tokenA))
        .expect(200);
      expect(on.body.data.isActive).toBe(true);
    });

    it('lists with search, status filter, pagination and summary', async () => {
      const marker = `Arama${run}`;
      const one = await create(tokenA, { legalName: `${marker} Bir` });
      await create(tokenA, { legalName: `${marker} İki` });
      await http()
        .post(`/api/v1/companies/${one.id}/deactivate`)
        .set(bearer(tokenA))
        .expect(200);

      const all = await http()
        .get(
          `/api/v1/companies?search=${encodeURIComponent(marker)}&per_page=1`,
        )
        .set(bearer(tokenA))
        .expect(200);
      expect(all.body.meta).toMatchObject({ total: 2, per_page: 1, page: 1 });
      expect(all.body.data).toHaveLength(1);

      const active = await http()
        .get(
          `/api/v1/companies?search=${encodeURIComponent(marker)}&status=active`,
        )
        .set(bearer(tokenA))
        .expect(200);
      expect(active.body.data.map((c: Company) => c.legalName)).toEqual([
        `${marker} İki`,
      ]);

      const byTax = await http()
        .get(`/api/v1/companies?search=${one.taxNumber}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(byTax.body.data[0].id).toBe(one.id);

      const summary = await http()
        .get('/api/v1/companies/summary')
        .set(bearer(tokenA))
        .expect(200);
      expect(summary.body.data.inactive).toBeGreaterThanOrEqual(1);
      expect(summary.body.data.total).toBe(
        summary.body.data.active + summary.body.data.inactive,
      );
    });

    it('rejects a duplicate tax number in the same tenant with 409', async () => {
      const taxNumber = uniqueVkn();
      await create(tokenA, { taxNumber });
      const res = await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send(companyBody({ taxNumber }))
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('allows the same tax number in another tenant', async () => {
      const taxNumber = uniqueVkn();
      await create(tokenA, { taxNumber });
      await create(tokenB, { taxNumber });
    });

    it('validates input (VKN/TCKN check digits, unknown fields)', async () => {
      const bad = await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send(companyBody({ taxNumber: invalidVkn() }))
        .expect(422);
      expect(
        bad.body.error.details.map((d: { field: string }) => d.field),
      ).toContain('taxNumber');
      await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send(companyBody({ tenantId: randomUUID() }))
        .expect(422);
      await http()
        .patch(`/api/v1/companies/${randomUUID()}`)
        .set(bearer(tokenA))
        .send({ taxNumber: uniqueVkn() })
        .expect(422);
    });

    it('accepts a valid TCKN', async () => {
      const company = await create(tokenA, {
        taxNumber: '10000000146',
        legalName: `Şahıs ${run}`,
      });
      expect(company.taxNumber).toBe('10000000146');
    });

    it('writes audit logs for create and update', async () => {
      const company = await create(tokenA);
      await http()
        .post(`/api/v1/companies/${company.id}/deactivate`)
        .set(bearer(tokenA))
        .expect(200);
      const logs = await http()
        .get(`/api/v1/audit-logs?entity_id=${company.id}`)
        .set(bearer(tokenA))
        .expect(200);
      const rows = logs.body.data as {
        action: string;
        module: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }[];
      expect(rows.map((r) => r.action).sort()).toEqual(['CREATE', 'UPDATE']);
      const update = rows.find((r) => r.action === 'UPDATE');
      expect(update?.module).toBe('companies');
      expect(update?.before).toEqual({ isActive: true });
      expect(update?.after).toEqual({ isActive: false });
    });
  });

  describe('tenant isolation', () => {
    it('hides other tenants’ companies (404, never listed, cannot change)', async () => {
      const company = await create(tokenA);
      await http()
        .get(`/api/v1/companies/${company.id}`)
        .set(bearer(tokenB))
        .expect(404);
      await http()
        .patch(`/api/v1/companies/${company.id}`)
        .set(bearer(tokenB))
        .send({ legalName: 'Ele geçirildi' })
        .expect(404);
      await http()
        .post(`/api/v1/companies/${company.id}/deactivate`)
        .set(bearer(tokenB))
        .expect(404);
      const list = await http()
        .get(`/api/v1/companies?search=${company.taxNumber}`)
        .set(bearer(tokenB))
        .expect(200);
      expect(list.body.data).toEqual([]);

      const still = await http()
        .get(`/api/v1/companies/${company.id}`)
        .set(bearer(tokenA))
        .expect(200);
      expect(still.body.data.isActive).toBe(true);
    });
  });

  describe('company-level access', () => {
    it('limits a user without companies:all to assigned companies', async () => {
      const assigned = await create(tokenA, { legalName: `Atanan ${run}` });
      const other = await create(tokenA, { legalName: `Atanmamış ${run}` });
      const email = `co-staff-${run}@test.local`;
      const passwordHash = await hash(PASSWORD);

      // Users are global and seeded with a membership; user_company_roles now
      // only accepts company-scope roles, and user_roles only tenant-scope ones,
      // so the same custom role is granted through the company assignment alone.
      const userId = await seedMember({
        email,
        name: 'Personel',
        passwordHash,
        memberships: [{ tenantId: tenantA }],
      });
      await TenantContext.run(tenantA, async () => {
        const role = await prisma.role.create({
          data: {
            tenantId: tenantA,
            name: `staff-${run}`,
            scope: 'company',
            permissions: ['companies:read', 'companies:write'],
          },
        });
        await prisma.userCompanyRole.create({
          data: {
            tenantId: tenantA,
            userId,
            companyId: assigned.id,
            roleId: role.id,
          },
        });
      });

      const staff = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.data.accessToken as string;

      const list = await http()
        .get('/api/v1/companies?per_page=100')
        .set(bearer(staff))
        .expect(200);
      expect(list.body.data.map((c: Company) => c.id)).toEqual([assigned.id]);

      await http()
        .get(`/api/v1/companies/${assigned.id}`)
        .set(bearer(staff))
        .expect(200);
      await http()
        .get(`/api/v1/companies/${other.id}`)
        .set(bearer(staff))
        .expect(404);
      await http()
        .patch(`/api/v1/companies/${other.id}`)
        .set(bearer(staff))
        .send({ city: 'İzmir' })
        .expect(404);
      // Creating needs tenant-wide access.
      await http()
        .post('/api/v1/companies')
        .set(bearer(staff))
        .send(companyBody())
        .expect(403);
    });

    /** A member with catalog role `role`: tenant-wide, or in the given companies. */
    const memberWith = async (
      label: string,
      role: 'admin' | 'operations' | 'accounting' | 'viewer',
      companyIds: string[] = [],
    ) => {
      const email = `co-${label}-${run}@test.local`;
      const tenantRole = role === 'admin';
      const roleId = await systemRoleId(tenantA, role);
      const userId = await seedMember({
        email,
        name: label,
        passwordHash: await hash(PASSWORD),
        memberships: [{ tenantId: tenantA, ...(tenantRole ? { roleId } : {}) }],
      });
      await TenantContext.run(tenantA, () =>
        prisma.userCompanyRole.createMany({
          data: companyIds.map((companyId) => ({
            tenantId: tenantA,
            userId,
            companyId,
            roleId,
          })),
        }),
      );
      const token = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.data.accessToken as string;
      return { userId, token };
    };

    it('a role in company A gives no access to company B', async () => {
      const a = await create(tokenA, { legalName: `A ${run}` });
      const b = await create(tokenA, { legalName: `B ${run}` });
      const { token } = await memberWith('ops-a', 'operations', [a.id]);
      await http()
        .get(`/api/v1/companies/${a.id}`)
        .set(bearer(token))
        .expect(200);
      await http()
        .get(`/api/v1/companies/${b.id}`)
        .set(bearer(token))
        .expect(404);
      await http()
        .patch(`/api/v1/companies/${b.id}`)
        .set(bearer(token))
        .send({ city: 'İzmir' })
        .expect(404);
      await http()
        .post(`/api/v1/companies/${b.id}/deactivate`)
        .set(bearer(token))
        .expect(404);
    });

    it('a company role can read its company but cannot write it', async () => {
      const a = await create(tokenA, { legalName: `Muhasebe ${run}` });
      const { token } = await memberWith('acc-a', 'accounting', [a.id]);
      await http()
        .get(`/api/v1/companies/${a.id}`)
        .set(bearer(token))
        .expect(200);
      const list = await http()
        .get('/api/v1/companies?per_page=100')
        .set(bearer(token))
        .expect(200);
      expect(list.body.data.map((c: Company) => c.id)).toEqual([a.id]);
      await http()
        .patch(`/api/v1/companies/${a.id}`)
        .set(bearer(token))
        .send({ city: 'İzmir' })
        .expect(403);
      for (const action of ['deactivate', 'activate']) {
        await http()
          .post(`/api/v1/companies/${a.id}/${action}`)
          .set(bearer(token))
          .expect(403);
      }
      const me = await http()
        .get('/api/v1/auth/me')
        .set(bearer(token))
        .expect(200);
      expect(me.body.data).toMatchObject({
        canManageUsers: false,
        canWriteAllCompanies: false,
        companyCapabilities: { [a.id]: { canWrite: false } },
      });
    });

    it('admin can write every company', async () => {
      const a = await create(tokenA, { legalName: `Admin A ${run}` });
      const b = await create(tokenA, { legalName: `Admin B ${run}` });
      const { token } = await memberWith('admin', 'admin');
      for (const id of [a.id, b.id]) {
        await http()
          .patch(`/api/v1/companies/${id}`)
          .set(bearer(token))
          .send({ city: 'Ankara' })
          .expect(200);
      }
      const list = await http()
        .get('/api/v1/companies?per_page=100')
        .set(bearer(token))
        .expect(200);
      const ids = list.body.data.map((c: Company) => c.id);
      expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
      const me = await http()
        .get('/api/v1/auth/me')
        .set(bearer(token))
        .expect(200);
      expect(me.body.data).toMatchObject({
        canManageUsers: true,
        canWriteAllCompanies: true,
        companyCapabilities: {},
      });
    });

    it('removing the company role blocks access with the old token', async () => {
      const a = await create(tokenA, { legalName: `Kaldırılan ${run}` });
      const { userId, token } = await memberWith('removed', 'viewer', [a.id]);
      await http()
        .get(`/api/v1/companies/${a.id}`)
        .set(bearer(token))
        .expect(200);

      // Only the assignment goes; auth_version is not bumped, so the token stays
      // valid and still carries companies:read. The check reads the database.
      await TenantContext.run(tenantA, () =>
        prisma.userCompanyRole.deleteMany({
          where: { userId, companyId: a.id },
        }),
      );
      await http()
        .get(`/api/v1/companies/${a.id}`)
        .set(bearer(token))
        .expect(404);
      const list = await http()
        .get('/api/v1/companies?per_page=100')
        .set(bearer(token))
        .expect(200);
      expect(list.body.data).toEqual([]);
    });
  });
});
