import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { createTestApp, ownerPool, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Orders API (e2e, ORD-02)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`ord-a-${run}`, `ord-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let companyB: string;
  let variantA1: string;
  let variantA2: string;
  let variantB: string;

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
  const company = async (token: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName: `Firma ${run} ${seq}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;
  const product = async (token: string, companyId: string, skus: string[]) =>
    (
      (
        await http()
          .post('/api/v1/products')
          .set(bearer(token))
          .send({
            companyId,
            name: `Tişört ${run}`,
            vatRate: '20',
            variants: skus.map((sku) => ({ sku })),
          })
          .expect(201)
      ).body.data.variants as { id: string }[]
    ).map((v) => v.id);

  const createOrder = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/orders').set(bearer(token)).send(body);
  const setStatus = (token: string, id: string, status: string) =>
    http()
      .post(`/api/v1/orders/${id}/status`)
      .set(bearer(token))
      .send({ status });

  beforeAll(async () => {
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    companyA = await company(tokenA);
    companyB = await company(tokenB);
    [variantA1, variantA2] = await product(tokenA, companyA, [
      `A1-${run}`,
      `A2-${run}`,
    ]);
    [variantB] = await product(tokenB, companyB, [`B1-${run}`]);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('creates a manual order: snapshot lines, exact decimal totals, first history row, audit', async () => {
    const res = await createOrder(tokenA, {
      companyId: companyA,
      currency: 'TRY',
      discountTotal: '10.00',
      shippingTotal: '29.99',
      items: [
        { variantId: variantA1, quantity: 3, unitPrice: '33.33' },
        {
          variantId: variantA2,
          quantity: 1,
          unitPrice: '199.90',
          discount: '0.10',
        },
      ],
    }).expect(201);
    const o = res.body.data;
    expect(o).toMatchObject({
      companyId: companyA,
      channel: 'manual',
      channelAccountId: null,
      externalOrderNo: null,
      status: 'created',
      currency: 'TRY',
      subtotal: '299.79', // 99.99 + 199.80
      discountTotal: '10.00',
      shippingTotal: '29.99',
      total: '319.78',
    });
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({
      variantId: variantA1,
      sku: `A1-${run}`,
      name: `Tişört ${run}`,
      quantity: 3,
      unitPrice: '33.33',
      discount: '0.00',
      vatRate: '20.00',
      lineTotal: '99.99',
    });
    expect(o.statusHistory).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'created',
        source: 'user',
      }),
    ]);
    const audit = await http()
      .get('/api/v1/audit-logs')
      .query({ module: 'orders' })
      .set(bearer(tokenA))
      .expect(200);
    expect(
      (audit.body.data as { entityId: string; action: string }[]).some(
        (a) => a.entityId === o.id && a.action === 'CREATE',
      ),
    ).toBe(true);
  });

  it('rejects invalid manual orders without writing anything', async () => {
    const before = (
      await http().get('/api/v1/orders').set(bearer(tokenA)).expect(200)
    ).body.meta.total as number;
    const base = { companyId: companyA, currency: 'TRY' };
    const cases: [Record<string, unknown>, number, string][] = [
      // Another tenant's variant looks like a missing one.
      [
        {
          ...base,
          items: [{ variantId: variantB, quantity: 1, unitPrice: '1.00' }],
        },
        422,
        'VARIANT_NOT_FOUND',
      ],
      [
        {
          ...base,
          items: [
            { variantId: variantA1, quantity: 1, unitPrice: '1.00' },
            { variantId: variantA1, quantity: 2, unitPrice: '1.00' },
          ],
        },
        422,
        'ORDER_ITEM_DUPLICATE',
      ],
      [
        {
          ...base,
          items: [
            {
              variantId: variantA1,
              quantity: 1,
              unitPrice: '5.00',
              discount: '6.00',
            },
          ],
        },
        422,
        'VALIDATION_ERROR',
      ],
      [
        {
          ...base,
          discountTotal: '6.00',
          items: [{ variantId: variantA1, quantity: 1, unitPrice: '5.00' }],
        },
        422,
        'VALIDATION_ERROR',
      ],
      // Amounts are decimal strings, never JSON numbers or 3 fraction digits.
      [
        {
          ...base,
          items: [{ variantId: variantA1, quantity: 1, unitPrice: 5 }],
        },
        422,
        'VALIDATION_ERROR',
      ],
      [
        {
          ...base,
          items: [{ variantId: variantA1, quantity: 1, unitPrice: '1.005' }],
        },
        422,
        'VALIDATION_ERROR',
      ],
      [
        {
          ...base,
          items: [{ variantId: variantA1, quantity: 0, unitPrice: '1.00' }],
        },
        422,
        'VALIDATION_ERROR',
      ],
      [{ ...base, items: [] }, 422, 'VALIDATION_ERROR'],
      [
        {
          ...base,
          currency: 'GBP',
          items: [{ variantId: variantA1, quantity: 1, unitPrice: '1.00' }],
        },
        422,
        'VALIDATION_ERROR',
      ],
      // Another tenant's company: no role there → 404.
      [
        {
          ...base,
          companyId: companyB,
          items: [{ variantId: variantB, quantity: 1, unitPrice: '1.00' }],
        },
        404,
        'NOT_FOUND',
      ],
    ];
    for (const [body, status, code] of cases) {
      const res = await createOrder(tokenA, body);
      expect({ status: res.status, code: res.body.error?.code }).toEqual({
        status,
        code,
      });
    }
    const after = (
      await http().get('/api/v1/orders').set(bearer(tokenA)).expect(200)
    ).body.meta.total as number;
    expect(after).toBe(before);
  });

  it('follows the status table: valid chain, invalid jump 409, final status stays final', async () => {
    const id = (
      await createOrder(tokenA, {
        companyId: companyA,
        currency: 'TRY',
        items: [{ variantId: variantA1, quantity: 1, unitPrice: '10.00' }],
      }).expect(201)
    ).body.data.id as string;
    for (const s of ['picking', 'invoiced', 'shipped', 'delivered']) {
      const res = await setStatus(tokenA, id, s).expect(200);
      expect(res.body.data.status).toBe(s);
    }
    const back = await setStatus(tokenA, id, 'picking').expect(409);
    expect(back.body.error.code).toBe('ORDER_TRANSITION_INVALID');
    await setStatus(tokenA, id, 'returned').expect(200);
    const fin = await setStatus(tokenA, id, 'shipped').expect(409);
    expect(fin.body.error.code).toBe('ORDER_TRANSITION_INVALID');
    expect((await setStatus(tokenA, id, 'finished')).status).toBe(422);
    const detail = (
      await http().get(`/api/v1/orders/${id}`).set(bearer(tokenA)).expect(200)
    ).body.data;
    expect(
      (
        detail.statusHistory as {
          fromStatus: string | null;
          toStatus: string;
        }[]
      ).map((h) => `${h.fromStatus ?? '-'}>${h.toStatus}`),
    ).toEqual([
      '->created',
      'created>picking',
      'picking>invoiced',
      'invoiced>shipped',
      'shipped>delivered',
      'delivered>returned',
    ]);
  });

  it('two concurrent changes from the same status: exactly one wins', async () => {
    const id = (
      await createOrder(tokenA, {
        companyId: companyA,
        currency: 'TRY',
        items: [{ variantId: variantA1, quantity: 1, unitPrice: '10.00' }],
      }).expect(201)
    ).body.data.id as string;
    const results = await Promise.all([
      setStatus(tokenA, id, 'cancelled'),
      setStatus(tokenA, id, 'picking'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const detail = (
      await http().get(`/api/v1/orders/${id}`).set(bearer(tokenA)).expect(200)
    ).body.data;
    expect(detail.statusHistory).toHaveLength(2);
  });

  it('marketplace orders change status only through their channel', async () => {
    const pool = ownerPool();
    let id: string;
    try {
      const { rows } = await pool.query<{ tid: string }>(
        'SELECT id AS tid FROM tenants WHERE slug = $1',
        [slugs[0]],
      );
      const tid = rows[0].tid;
      const account = randomUUID();
      await pool.query(
        `insert into channel_accounts (id, tenant_id, company_id, channel, name, credentials_ciphertext, credentials_iv,
           credentials_tag, wrapped_dek, dek_iv, dek_tag, kek_id, credentials_hint, updated_at)
         values ($1, $2, $3, 'trendyol', $4, decode('00', 'hex'), decode(repeat('00', 12), 'hex'),
           decode(repeat('00', 16), 'hex'), decode(repeat('00', 32), 'hex'), decode(repeat('00', 12), 'hex'),
           decode(repeat('00', 16), 'hex'), 'k1', '{}', now())`,
        [account, tid, companyA, `TY ${run}`],
      );
      id = (
        await pool.query<{ id: string }>(
          `insert into orders (id, tenant_id, company_id, channel, channel_account_id, external_order_no, status, currency,
             subtotal, total, ordered_at, updated_at)
           values (gen_random_uuid(), $1, $2, 'trendyol', $3, $4, 'created', 'TRY', 10, 10, now(), now()) returning id`,
          [tid, companyA, account, `TY-${run}`],
        )
      ).rows[0].id;
    } finally {
      await pool.end();
    }
    const res = await setStatus(tokenA, id, 'picking').expect(409);
    expect(res.body.error.code).toBe('CHANNEL_MANAGED');
    const list = await http()
      .get('/api/v1/orders')
      .query({ channel: 'trendyol', search: `TY-${run}` })
      .set(bearer(tokenA))
      .expect(200);
    expect(list.body.data.map((o: { id: string }) => o.id)).toEqual([id]);
    expect(list.body.data[0].status).toBe('created');
  });

  it('tenant isolation: the other tenant sees nothing and gets 404', async () => {
    const id = (
      await createOrder(tokenA, {
        companyId: companyA,
        currency: 'TRY',
        items: [{ variantId: variantA1, quantity: 1, unitPrice: '1.00' }],
      }).expect(201)
    ).body.data.id as string;
    await http().get(`/api/v1/orders/${id}`).set(bearer(tokenB)).expect(404);
    await setStatus(tokenB, id, 'picking').expect(404);
    const listB = await http()
      .get('/api/v1/orders')
      .set(bearer(tokenB))
      .expect(200);
    expect(listB.body.meta.total).toBe(0);
    await http().get('/api/v1/orders').expect(401);
    await http()
      .get('/api/v1/orders/not-a-uuid')
      .set(bearer(tokenA))
      .expect(404);
  });

  it('lists with filters and pagination, newest first', async () => {
    const page = await http()
      .get('/api/v1/orders')
      .query({ status: 'created', company_id: companyA, per_page: 1 })
      .set(bearer(tokenA))
      .expect(200);
    expect(page.body.meta).toMatchObject({ page: 1, per_page: 1 });
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].status).toBe('created');
    expect(page.body.data[0]).not.toHaveProperty('items');
    await http()
      .get('/api/v1/orders')
      .query({ status: 'done' })
      .set(bearer(tokenA))
      .expect(422);
  });
});
