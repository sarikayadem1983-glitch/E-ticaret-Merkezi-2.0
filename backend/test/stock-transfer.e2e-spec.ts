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

describe('Stock transfer and count (e2e, INV-04)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`trf-a-${run}`, `trf-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let companyA2: string;
  let variant: string;
  let w1: string;
  let w2: string;
  let wOther: string;

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
  const company = async () =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
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
  const warehouse = async (companyId: string, name: string) =>
    (
      await http()
        .post('/api/v1/warehouses')
        .set(bearer(tokenA))
        .send({ companyId, name })
        .expect(201)
    ).body.data.id as string;
  const onHand = async (warehouseId: string) =>
    (
      (
        await http()
          .get('/api/v1/stock-levels')
          .query({ warehouse_id: warehouseId, variant_id: variant })
          .set(bearer(tokenA))
          .expect(200)
      ).body.data[0] as { onHand: number } | undefined
    )?.onHand ?? 0;
  const transfer = (
    from: string,
    to: string,
    quantity: number,
    token = tokenA,
  ) =>
    http().post('/api/v1/stock-transfers').set(bearer(token)).send({
      fromWarehouseId: from,
      toWarehouseId: to,
      variantId: variant,
      quantity,
    });
  const count = (warehouseId: string, counted: number) =>
    http()
      .post('/api/v1/stock-counts')
      .set(bearer(tokenA))
      .send({ warehouseId, variantId: variant, counted });

  beforeAll(async () => {
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    companyA = await company();
    companyA2 = await company();
    variant = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `Kavanoz ${run}`,
          variants: [{ sku: `KV-${run}` }],
        })
        .expect(201)
    ).body.data.variants[0].id;
    w1 = await warehouse(companyA, 'Ana');
    w2 = await warehouse(companyA, 'Mağaza');
    wOther = await warehouse(companyA2, 'Diğer');
    await http()
      .post('/api/v1/stock-movements')
      .set(bearer(tokenA))
      .send({
        warehouseId: w1,
        variantId: variant,
        quantity: 10,
        reason: 'opening',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('a transfer is two movements with one reference; totals stay the same', async () => {
    const res = await transfer(w1, w2, 4).expect(201);
    expect(await onHand(w1)).toBe(6);
    expect(await onHand(w2)).toBe(4);
    const moves = await http()
      .get('/api/v1/stock-movements')
      .query({ variant_id: variant })
      .set(bearer(tokenA))
      .expect(200);
    const pair = (
      moves.body.data as {
        reason: string;
        quantity: number;
        referenceId: string;
      }[]
    ).filter((m) => m.referenceId === res.body.data.transferId);
    expect(pair.map((m) => `${m.reason}:${m.quantity}`).sort()).toEqual([
      'transfer_in:4',
      'transfer_out:-4',
    ]);
  });

  it('refuses impossible transfers and writes nothing', async () => {
    expect((await transfer(w1, w2, 7)).body.error.code).toBe(
      'STOCK_INSUFFICIENT',
    );
    expect((await transfer(w1, w1, 1)).status).toBe(422);
    expect((await transfer(w1, wOther, 1)).status).toBe(422);
    expect((await transfer(w1, w2, 0)).status).toBe(422);
    expect((await transfer(w1, w2, 1, tokenB)).status).toBe(404);
    expect(await onHand(w1)).toBe(6);
    expect(await onHand(w2)).toBe(4);
  });

  it('a count writes only the difference', async () => {
    expect((await count(w1, 5).expect(201)).body.data).toEqual({
      counted: 5,
      difference: -1,
    });
    expect((await count(w1, 5).expect(201)).body.data).toEqual({
      counted: 5,
      difference: 0,
    });
    expect((await count(w2, 9).expect(201)).body.data).toEqual({
      counted: 9,
      difference: 5,
    });
    expect(await onHand(w1)).toBe(5);
    expect(await onHand(w2)).toBe(9);
    expect((await count(w1, -1)).status).toBe(422);
  });
});
