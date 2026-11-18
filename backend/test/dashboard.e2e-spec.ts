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

describe('Dashboard KPIs (e2e, DSH-02)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`dsh-a-${run}`, `dsh-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let variant: string;

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
  const kpis = async (token = tokenA) =>
    (await http().get('/api/v1/dashboard/kpis').set(bearer(token)).expect(200))
      .body.data;

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
    variant = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `Lamba ${run}`,
          variants: [{ sku: `L-${run}` }],
        })
        .expect(201)
    ).body.data.variants[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('starts empty: zero sales, nothing pending, no low stock, no errors', async () => {
    expect(await kpis()).toMatchObject({
      todaySales: [],
      pendingShipment: 0,
      lowStock: 0,
      integrationErrors: 0,
    });
  });

  it('matches the sales report and counts pending orders and low stock', async () => {
    const make = async (price: string) =>
      (
        await http()
          .post('/api/v1/orders')
          .set(bearer(tokenA))
          .send({
            companyId: companyA,
            currency: 'TRY',
            items: [{ variantId: variant, quantity: 1, unitPrice: price }],
          })
          .expect(201)
      ).body.data.id as string;
    await make('10.10');
    const shipped = await make('0.20');
    const cancelled = await make('99.00');
    await http()
      .post(`/api/v1/orders/${shipped}/status`)
      .set(bearer(tokenA))
      .send({ status: 'shipped' })
      .expect(200);
    await http()
      .post(`/api/v1/orders/${cancelled}/status`)
      .set(bearer(tokenA))
      .send({ status: 'cancelled' })
      .expect(200);
    await http()
      .put(`/api/v1/stock-thresholds/${variant}`)
      .set(bearer(tokenA))
      .send({ threshold: 2 })
      .expect(200);

    const k = await kpis();
    const report = await http()
      .get('/api/v1/reports/sales')
      .query({ from: k.day, to: k.day })
      .set(bearer(tokenA))
      .expect(200);
    expect(k.todaySales).toEqual(report.body.meta.totals);
    expect(k.todaySales).toEqual([
      { currency: 'TRY', orders: 2, revenue: '10.30', returned: 0 },
    ]);
    expect(k.pendingShipment).toBe(1);
    expect(k.lowStock).toBe(1);
    expect(k.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('another tenant sees only its own (empty) numbers; no token → 401', async () => {
    expect(await kpis(tokenB)).toMatchObject({
      todaySales: [],
      pendingShipment: 0,
      lowStock: 0,
    });
    await http().get('/api/v1/dashboard/kpis').expect(401);
    await http()
      .get('/api/v1/dashboard/kpis')
      .query({ company_id: 'x' })
      .set(bearer(tokenA))
      .expect(422);
  });
});
