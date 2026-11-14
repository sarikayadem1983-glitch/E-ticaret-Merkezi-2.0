import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { createTestApp, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Sales reports (e2e, RPT-01)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`rpt-a-${run}`, `rpt-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let v1: string;
  let v2: string;

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
  const order = async (
    orderedAt: string,
    items: { variantId: string; quantity: number; unitPrice: string }[],
    currency = 'TRY',
  ) =>
    (
      await http()
        .post('/api/v1/orders')
        .set(bearer(tokenA))
        .send({ companyId: companyA, currency, orderedAt, items })
        .expect(201)
    ).body.data.id as string;
  const status = (id: string, s: string) =>
    http()
      .post(`/api/v1/orders/${id}/status`)
      .set(bearer(tokenA))
      .send({ status: s })
      .expect(200);
  const report = (q: Record<string, string>, token = tokenA) =>
    http().get('/api/v1/reports/sales').query(q).set(bearer(token));

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
    [v1, v2] = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `Çanta ${run}`,
          variants: [{ sku: `R1-${run}` }, { sku: `R2-${run}` }],
        })
        .expect(201)
    ).body.data.variants.map((v: { id: string }) => v.id);

    // 13 Nov (Istanbul): 2 × 10.10 + 1 × 0.20 = 20.40
    await order('2026-11-13T09:00:00.000Z', [
      { variantId: v1, quantity: 2, unitPrice: '10.10' },
      { variantId: v2, quantity: 1, unitPrice: '0.20' },
    ]);
    // 14 Nov 00:30 Istanbul = 13 Nov 21:30 UTC → counted on 14 Nov.
    await order('2026-11-13T21:30:00.000Z', [
      { variantId: v1, quantity: 1, unitPrice: '5.00' },
    ]);
    // EUR order on 14 Nov stays in its own currency.
    await order(
      '2026-11-14T10:00:00.000Z',
      [{ variantId: v2, quantity: 3, unitPrice: '1.00' }],
      'EUR',
    );
    // Cancelled: not a sale. Returned: counted separately.
    const cancelled = await order('2026-11-14T11:00:00.000Z', [
      { variantId: v1, quantity: 9, unitPrice: '99.00' },
    ]);
    await status(cancelled, 'cancelled');
    const returned = await order('2026-11-14T12:00:00.000Z', [
      { variantId: v2, quantity: 1, unitPrice: '7.00' },
    ]);
    for (const s of ['shipped', 'delivered', 'returned'])
      await status(returned, s);
    // Outside the range.
    await order('2026-11-20T10:00:00.000Z', [
      { variantId: v1, quantity: 1, unitPrice: '1000.00' },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  const range = { from: '2026-11-13', to: '2026-11-14' };

  it('groups by Istanbul day with exact decimal totals per currency', async () => {
    const res = await report({ ...range, group_by: 'day' }).expect(200);
    expect(
      res.body.data.map((r: Record<string, unknown>) => [
        r.key,
        r.currency,
        r.orders,
        r.quantity,
        r.revenue,
        r.returned,
      ]),
    ).toEqual([
      ['2026-11-13', 'TRY', 1, 3, '20.40', 0],
      ['2026-11-14', 'EUR', 1, 3, '3.00', 0],
      ['2026-11-14', 'TRY', 1, 1, '5.00', 1],
    ]);
    expect(res.body.meta.totals).toEqual([
      { currency: 'EUR', orders: 1, revenue: '3.00', returned: 0 },
      { currency: 'TRY', orders: 2, revenue: '25.40', returned: 1 },
    ]);
    expect(res.body.meta.excludedStatuses).toEqual(['cancelled', 'unsupplied']);
  });

  it('groups by product and by channel', async () => {
    const byProduct = await report({ ...range, group_by: 'product' }).expect(
      200,
    );
    expect(
      byProduct.body.data.map((r: Record<string, unknown>) => [
        r.key,
        r.currency,
        r.quantity,
        r.revenue,
        r.returned,
      ]),
    ).toEqual([
      [`R1-${run}`, 'TRY', 3, '25.20', 0],
      [`R2-${run}`, 'EUR', 3, '3.00', 0],
      [`R2-${run}`, 'TRY', 1, '0.20', 1],
    ]);
    const byChannel = await report({
      ...range,
      group_by: 'channel',
      channel: 'manual',
    }).expect(200);
    expect(
      byChannel.body.data.map((r: Record<string, unknown>) => [
        r.key,
        r.currency,
        r.orders,
      ]),
    ).toEqual([
      ['manual', 'TRY', 2],
      ['manual', 'EUR', 1],
    ]);
  });

  it('validates the range', async () => {
    expect(
      (await report({ from: '2026-11-14', to: '2026-11-13' })).status,
    ).toBe(422);
    expect(
      (await report({ from: '2025-01-01', to: '2026-11-14' })).status,
    ).toBe(422);
    expect(
      (await report({ from: '14.11.2026', to: '2026-11-14' })).status,
    ).toBe(422);
    expect((await report({ ...range, group_by: 'month' })).status).toBe(422);
    expect((await report({ to: '2026-11-14' })).status).toBe(422);
  });

  it('shows another tenant nothing', async () => {
    const res = await report({ ...range }, tokenB).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.totals).toEqual([]);
    const foreign = await report(
      { ...range, company_id: companyA },
      tokenB,
    ).expect(200);
    expect(foreign.body.data).toEqual([]);
    await http().get('/api/v1/reports/sales').query(range).expect(401);
  });
});
