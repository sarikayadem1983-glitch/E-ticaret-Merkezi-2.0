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

describe('Inventory and reservations API (e2e, INV-02)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`inv-a-${run}`, `inv-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let variant: string;
  let warehouse: string;

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

  const level = async () =>
    (
      await http()
        .get('/api/v1/stock-levels')
        .query({ warehouse_id: warehouse, variant_id: variant })
        .set(bearer(tokenA))
        .expect(200)
    ).body.data[0] as {
      onHand: number;
      reserved: number;
      available: number;
      sku: string;
    };
  const order = async (quantity: number) =>
    (
      await http()
        .post('/api/v1/orders')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          currency: 'TRY',
          items: [{ variantId: variant, quantity, unitPrice: '10.00' }],
        })
        .expect(201)
    ).body.data.id as string;
  const move = (quantity: number, reason: string, token = tokenA) =>
    http()
      .post('/api/v1/stock-movements')
      .set(bearer(token))
      .send({ warehouseId: warehouse, variantId: variant, quantity, reason });

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
          name: `Kupa ${run}`,
          variants: [{ sku: `K-${run}` }],
        })
        .expect(201)
    ).body.data.variants[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('creates warehouses: one default per company, unique names', async () => {
    const res = await http()
      .post('/api/v1/warehouses')
      .set(bearer(tokenA))
      .send({ companyId: companyA, name: 'Ana Depo', isDefault: true })
      .expect(201);
    warehouse = res.body.data.id;
    const dup = await http()
      .post('/api/v1/warehouses')
      .set(bearer(tokenA))
      .send({ companyId: companyA, name: 'ana depo' })
      .expect(409);
    expect(dup.body.error.code).toBe('WAREHOUSE_NAME_TAKEN');
    const def = await http()
      .post('/api/v1/warehouses')
      .set(bearer(tokenA))
      .send({ companyId: companyA, name: 'Yedek', isDefault: true })
      .expect(409);
    expect(def.body.error.code).toBe('WAREHOUSE_DEFAULT_TAKEN');
    const list = await http()
      .get('/api/v1/warehouses')
      .set(bearer(tokenA))
      .expect(200);
    expect(list.body.data.map((w: { name: string }) => w.name)).toEqual([
      'Ana Depo',
    ]);
    // The other tenant sees nothing and cannot write into this company.
    expect(
      (await http().get('/api/v1/warehouses').set(bearer(tokenB)).expect(200))
        .body.data,
    ).toEqual([]);
    await http()
      .post('/api/v1/warehouses')
      .set(bearer(tokenB))
      .send({ companyId: companyA, name: 'X' })
      .expect(404);
  });

  it('manual movements change stock; it never goes negative', async () => {
    await move(10, 'opening').expect(201);
    expect(await level()).toMatchObject({
      onHand: 10,
      reserved: 0,
      available: 10,
      sku: `K-${run}`,
    });
    await move(-1, 'adjustment').expect(201);
    const neg = await move(-50, 'adjustment').expect(409);
    expect(neg.body.error.code).toBe('STOCK_INSUFFICIENT');
    await move(-1, 'purchase').expect(422);
    await move(1, 'order').expect(422);
    await move(0, 'count').expect(422);
    await move(1, 'opening', tokenB).expect(404);
    expect(await level()).toMatchObject({ onHand: 9, reserved: 0 });
  });

  it('reserves an order, refuses to oversell concurrently, ships and cancels', async () => {
    const o1 = await order(6);
    const o2 = await order(6);
    // 9 on hand: only one of two concurrent 6-unit reservations can succeed.
    const results = await Promise.all(
      [o1, o2].map((id) =>
        http()
          .post(`/api/v1/orders/${id}/reserve`)
          .set(bearer(tokenA))
          .send({}),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe(
      'STOCK_INSUFFICIENT',
    );
    expect(await level()).toMatchObject({
      onHand: 9,
      reserved: 6,
      available: 3,
    });
    const winner = results[0].status === 200 ? o1 : o2;
    const loser = winner === o1 ? o2 : o1;

    // Reserved units cannot be adjusted away.
    const cut = await move(-5, 'adjustment').expect(409);
    expect(cut.body.error.code).toBe('STOCK_RESERVED');

    // Repeating the same reservation is idempotent.
    await http()
      .post(`/api/v1/orders/${winner}/reserve`)
      .set(bearer(tokenA))
      .send({})
      .expect(200);
    expect(await level()).toMatchObject({ reserved: 6 });

    // Shipping consumes the reservation as an 'order' movement.
    await http()
      .post(`/api/v1/orders/${winner}/status`)
      .set(bearer(tokenA))
      .send({ status: 'shipped' })
      .expect(200);
    expect(await level()).toMatchObject({
      onHand: 3,
      reserved: 0,
      available: 3,
    });
    await http()
      .post(`/api/v1/orders/${winner}/reserve`)
      .set(bearer(tokenA))
      .send({})
      .expect(409);

    // A smaller order fits now; cancelling releases it without touching on_hand.
    const o3 = await order(2);
    await http()
      .post(`/api/v1/orders/${o3}/reserve`)
      .set(bearer(tokenA))
      .send({})
      .expect(200);
    expect(await level()).toMatchObject({ onHand: 3, reserved: 2 });
    await http()
      .post(`/api/v1/orders/${o3}/status`)
      .set(bearer(tokenA))
      .send({ status: 'cancelled' })
      .expect(200);
    expect(await level()).toMatchObject({ onHand: 3, reserved: 0 });
    // The loser can be cancelled with nothing reserved.
    await http()
      .post(`/api/v1/orders/${loser}/status`)
      .set(bearer(tokenA))
      .send({ status: 'cancelled' })
      .expect(200);

    const moves = await http()
      .get('/api/v1/stock-movements')
      .query({ variant_id: variant })
      .set(bearer(tokenA))
      .expect(200);
    expect(
      (moves.body.data as { reason: string; quantity: number }[]).map(
        (m) => `${m.reason}:${m.quantity}`,
      ),
    ).toEqual(['order:-6', 'adjustment:-1', 'opening:10']);
  });

  it('other tenant: no reservation on foreign orders, no levels, foreign warehouse refused', async () => {
    const id = await order(1);
    await http()
      .post(`/api/v1/orders/${id}/reserve`)
      .set(bearer(tokenB))
      .send({})
      .expect(404);
    expect(
      (await http().get('/api/v1/stock-levels').set(bearer(tokenB)).expect(200))
        .body.meta.total,
    ).toBe(0);
    const bad = await http()
      .post(`/api/v1/orders/${id}/reserve`)
      .set(bearer(tokenA))
      .send({ warehouseId: randomUUID() })
      .expect(404);
    expect(bad.body.error.code).toBe('NOT_FOUND');
  });
});
