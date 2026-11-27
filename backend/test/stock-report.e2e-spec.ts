import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { createTestApp, purgeTenants, registerOwner } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Stock report (e2e, RPT-02)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`srp-a-${run}`, `srp-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let product: string;
  let v1: string;
  let v2: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const register = async (slug: string) =>
    (
      await registerOwner(app, {
        tenantName: `Mağaza ${slug}`,
        tenantSlug: slug,
        name: 'Sahip',
        email: `${slug}@test.local`,
        password: PASSWORD,
      })
    ).body.data.accessToken as string;
  const report = (q: Record<string, string> = {}, token = tokenA) =>
    http().get('/api/v1/reports/stock').query(q).set(bearer(token));

  beforeAll(async () => {
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    companyA = (
      await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send({
          legalName: `Firma ${run}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id;
    const created = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `Çanta ${run}`,
          variants: [{ sku: `S1-${run}` }, { sku: `S2-${run}` }],
        })
        .expect(201)
    ).body.data;
    product = created.id;
    [v1, v2] = created.variants.map((v: { id: string }) => v.id);
    const warehouse = (
      await http()
        .post('/api/v1/warehouses')
        .set(bearer(tokenA))
        .send({ companyId: companyA, name: 'Ana Depo', isDefault: true })
        .expect(201)
    ).body.data.id;
    await http()
      .post('/api/v1/stock-movements')
      .set(bearer(tokenA))
      .send({
        warehouseId: warehouse,
        variantId: v1,
        quantity: 10,
        reason: 'purchase',
      })
      .expect(201);
    await http()
      .put(`/api/v1/products/${product}/variants/${v1}/cost`)
      .set(bearer(tokenA))
      .send({ amount: '12.50', currency: 'TRY' })
      .expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('values stock at the current cost and lists out-of-stock variants first', async () => {
    const res = await report().expect(200);
    expect(
      res.body.data.map((r: { variantId: string }) => r.variantId),
    ).toEqual([v2, v1]);
    expect(res.body.data[0]).toMatchObject({
      sku: `S2-${run}`,
      name: `Çanta ${run}`,
      onHand: 0,
      outOfStock: true,
      unitCost: null,
      value: null,
    });
    expect(res.body.data[1]).toMatchObject({
      onHand: 10,
      available: 10,
      soldUnits: 0,
      turnover: '0.00',
      daysOfCover: null,
      outOfStock: false,
      unitCost: '12.50',
      value: '125.00',
      currency: 'TRY',
    });
    expect(res.body.meta).toEqual({
      days: 30,
      totals: {
        variants: 2,
        outOfStock: 1,
        onHand: 10,
        soldUnits: 0,
        value: [{ currency: 'TRY', amount: '125.00' }],
        missingCost: 1,
      },
    });
  });

  it('filters by company and never shows another tenant', async () => {
    const own = await report({ company_id: companyA }).expect(200);
    expect(own.body.data).toHaveLength(2);
    const other = await report({ company_id: companyA }, tokenB).expect(200);
    expect(other.body.data).toEqual([]);
    const all = await report({}, tokenB).expect(200);
    expect(all.body.meta.totals.variants).toBe(0);
  });

  it('rejects invalid parameters', async () => {
    await report({ days: '0' }).expect(422);
    await report({ days: '367' }).expect(422);
    await report({ company_id: 'x' }).expect(422);
    await report({ extra: '1' }).expect(422);
  });

  it('requires a session', async () => {
    await http().get('/api/v1/reports/stock').expect(401);
  });
});
