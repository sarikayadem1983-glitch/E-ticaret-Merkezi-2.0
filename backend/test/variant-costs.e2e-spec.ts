import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AuditService } from '../src/audit/audit.service.js';
import { isValidVkn } from '../src/companies/tax-number.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from '../src/database/prisma.service.js';
import { TenantContext } from '../src/tenancy/tenant-context.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  registerOwner,
  seedMember,
  systemRoleId,
} from './helpers.js';

describe('Purchase cost API (RPT-02 prerequisite)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`cost-a-${run}`, `cost-b-${run}`];
  const password = 'Correct-Horse-9';
  let a: string,
    b: string,
    tenant: string,
    company: string,
    otherCompany: string,
    product: string,
    variant: string,
    otherProduct: string;
  const http = () => request(app.getHttpServer());
  const auth = (token = a) => ({ Authorization: `Bearer ${token}` });
  const url = (p = product, v = variant) =>
    `/api/v1/products/${p}/variants/${v}/cost`;
  const put = (body: object, token = a) =>
    http().put(url()).set(auth(token)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = [];
    for (const slug of slugs)
      tokens.push(
        (
          await registerOwner(app, {
            tenantName: slug,
            tenantSlug: slug,
            name: 'Owner',
            email: `${slug}@test.local`,
            password,
          })
        ).body.data.accessToken as string,
      );
    [a, b] = tokens;
    tenant = (await http().get('/api/v1/auth/me').set(auth()).expect(200)).body
      .data.tenantId;
    const prefix = String(Date.now() % 1e8).padStart(8, '0');
    const companies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const head = prefix + i;
      const taxNumber = '0123456789'
        .split('')
        .map((d) => head + d)
        .find(isValidVkn);
      companies.push(
        (
          await http()
            .post('/api/v1/companies')
            .set(auth())
            .send({
              legalName: `Cost ${i}`,
              taxNumber,
              taxOffice: 'Kadıköy',
              addressLine: 'Moda Cad.',
              district: 'Kadıköy',
              city: 'İstanbul',
            })
            .expect(201)
        ).body.data.id,
      );
    }
    [company, otherCompany] = companies;
    const products = [];
    for (let i = 0; i < 2; i++)
      products.push(
        (
          await http()
            .post('/api/v1/products')
            .set(auth())
            .send({
              companyId: company,
              name: `Cost ${i}`,
              variants: [
                {
                  sku: `COST-${i}-${run}`,
                  prices: [
                    { channel: 'list', amount: '199.90', currency: 'TRY' },
                  ],
                },
              ],
            })
            .expect(201)
        ).body.data,
      );
    product = products[0].id;
    variant = products[0].variants[0].id;
    otherProduct = products[1].id;
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('requires authentication and preserves unknown versus zero cost', async () => {
    await http().get(url()).expect(401);
    expect(
      (await http().get(url()).set(auth()).expect(200)).body.data,
    ).toBeNull();
    expect(
      (await put({ amount: '0', currency: 'TRY' }).expect(200)).body.data
        .amount,
    ).toBe('0.00');
  });

  it('persists exact cost and audit without changing or exposing it in normal product payloads', async () => {
    await put({ amount: '12.50', currency: 'EUR' }).expect(200);
    expect(
      (await http().get(url()).set(auth()).expect(200)).body.data,
    ).toMatchObject({ amount: '12.50', currency: 'EUR' });
    const p = (
      await http().get(`/api/v1/products/${product}`).set(auth()).expect(200)
    ).body.data;
    expect(p.variants[0].prices[0].amount).toBe('199.90');
    for (const key of ['purchaseCost', 'costCurrency', 'purchaseCostUpdatedAt'])
      expect(p.variants[0]).not.toHaveProperty(key);
    const pool = ownerPool();
    try {
      const { rows } = await pool.query(
        `SELECT action, after FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND entity_type='VariantPurchaseCost' ORDER BY created_at`,
        [tenant, variant],
      );
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      expect(rows.at(-1).after).toMatchObject({
        changedFields: ['amount', 'currency'],
      });
      const logs = (
        await http()
          .get('/api/v1/audit-logs')
          .query({ entity_type: 'VariantPurchaseCost' })
          .set(auth())
          .expect(200)
      ).body.data;
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        const detail = (
          await http()
            .get(`/api/v1/audit-logs/${log.id}`)
            .set(auth())
            .expect(200)
        ).body.data;
        for (const entry of [log, detail]) {
          expect(entry.before).not.toHaveProperty('amount');
          expect(entry.after).not.toHaveProperty('amount');
          expect(entry.after).not.toHaveProperty('currency');
        }
      }
    } finally {
      await pool.end();
    }
  });

  it('rejects malformed amounts, currency and injected fields', async () => {
    for (const amount of [
      1.5,
      null,
      '-1',
      'NaN',
      'Infinity',
      '1.001',
      '10000000000',
      '1,50',
    ])
      await put({ amount, currency: 'TRY' }).expect(422);
    await put({ amount: '1', currency: 'GBP' }).expect(422);
    await put({ amount: '1', currency: 'TRY', companyId: otherCompany }).expect(
      422,
    );
    expect(
      (await http().get(url()).set(auth()).expect(200)).body.data.amount,
    ).toBe('12.50');
  });

  it('rejects cross-tenant and wrong parent variants', async () => {
    await http().get(url()).set(auth(b)).expect(404);
    await put({ amount: '1', currency: 'TRY' }, b).expect(404);
    await http().get(url(otherProduct)).set(auth()).expect(404);
    await http()
      .put(url(otherProduct))
      .set(auth())
      .send({ amount: '1', currency: 'TRY' })
      .expect(404);
  });

  it('enforces company role boundaries for viewers and operations users', async () => {
    const prisma = app.get<TenantPrismaClient>(PRISMA);
    for (const [key, targetCompany, expected] of [
      ['viewer', company, 403],
      ['operations', otherCompany, 404],
    ] as const) {
      const email = `cost-${key}-${run}@test.local`;
      const roleId = await systemRoleId(tenant, key);
      const userId = await seedMember({
        email,
        name: key,
        passwordHash: await hash(password),
        memberships: [{ tenantId: tenant }],
      });
      await TenantContext.run(tenant, () =>
        prisma.userCompanyRole.create({
          data: { tenantId: tenant, userId, companyId: targetCompany, roleId },
        }),
      );
      const token = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password })
          .expect(200)
      ).body.data.accessToken;
      await http().get(url()).set(auth(token)).expect(expected);
      await put({ amount: '1', currency: 'TRY' }, token).expect(expected);
    }
  });

  it('rolls back the cost when audit storage fails', async () => {
    const before = (await http().get(url()).set(auth()).expect(200)).body.data;
    const pool = ownerPool();
    const count = async () =>
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND entity_type='VariantPurchaseCost'`,
          [tenant, variant],
        )
      ).rows[0].n;
    const n = await count();
    const spy = vi
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('injected cost audit failure'));
    try {
      await put({ amount: '99.99', currency: 'TRY' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    try {
      expect(
        (await http().get(url()).set(auth()).expect(200)).body.data,
      ).toEqual(before);
      expect(await count()).toBe(n);
    } finally {
      await pool.end();
    }
  });

  it('allows reads but freezes cost writes in an inactive company', async () => {
    await http()
      .post(`/api/v1/companies/${company}/deactivate`)
      .set(auth())
      .expect(200);
    try {
      await http().get(url()).set(auth()).expect(200);
      const res = await put({ amount: '1', currency: 'TRY' }).expect(409);
      expect(res.body.error.code).toBe('COMPANY_INACTIVE');
    } finally {
      await http()
        .post(`/api/v1/companies/${company}/activate`)
        .set(auth())
        .expect(200);
    }
  });
});
