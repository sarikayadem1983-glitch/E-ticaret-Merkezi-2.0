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

describe('Low-stock thresholds (e2e, INV-03)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`thr-a-${run}`, `thr-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;
  let v1: string;
  let v2: string;
  let v3: string;
  let w1: string;
  let w2: string;

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
  const setThreshold = (
    variantId: string,
    threshold: number | null,
    token = tokenA,
  ) =>
    http()
      .put(`/api/v1/stock-thresholds/${variantId}`)
      .set(bearer(token))
      .send({ threshold });
  const move = (warehouseId: string, variantId: string, quantity: number) =>
    http()
      .post('/api/v1/stock-movements')
      .set(bearer(tokenA))
      .send({ warehouseId, variantId, quantity, reason: 'opening' })
      .expect(201);
  const low = async (token = tokenA) =>
    (
      await http()
        .get('/api/v1/stock-levels/low')
        .set(bearer(token))
        .expect(200)
    ).body.data as {
      variantId: string;
      sku: string;
      threshold: number;
      available: number;
    }[];

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
    [v1, v2, v3] = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `Defter ${run}`,
          variants: [
            { sku: `T1-${run}` },
            { sku: `T2-${run}` },
            { sku: `T3-${run}` },
          ],
        })
        .expect(201)
    ).body.data.variants.map((v: { id: string }) => v.id);
    [w1, w2] = await Promise.all(
      ['Ana', 'Yedek'].map(
        async (name, i) =>
          (
            await http()
              .post('/api/v1/warehouses')
              .set(bearer(tokenA))
              .send({ companyId: companyA, name, isDefault: i === 0 })
              .expect(201)
          ).body.data.id as string,
      ),
    );
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('lists variants at or below their threshold, summing all warehouses', async () => {
    await move(w1, v1, 3);
    await move(w2, v1, 3); // v1: 6 in total
    await move(w1, v2, 10);
    // v3 has no stock rows at all: counts as 0.
    expect((await setThreshold(v1, 6)).status).toBe(200);
    expect((await setThreshold(v2, 5)).status).toBe(200);
    expect((await setThreshold(v3, 0)).status).toBe(200);
    const rows = await low();
    expect(rows.map((r) => [r.sku, r.available, r.threshold])).toEqual([
      [`T3-${run}`, 0, 0],
      [`T1-${run}`, 6, 6],
    ]);
    // Raising stock above the threshold removes it from the list.
    await move(w1, v1, 1);
    expect((await low()).map((r) => r.sku)).toEqual([`T3-${run}`]);
  });

  it('reserved units are not available', async () => {
    const o = (
      await http()
        .post('/api/v1/orders')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          currency: 'TRY',
          items: [{ variantId: v2, quantity: 6, unitPrice: '1.00' }],
        })
        .expect(201)
    ).body.data.id;
    await http()
      .post(`/api/v1/orders/${o}/reserve`)
      .set(bearer(tokenA))
      .send({})
      .expect(200);
    expect((await low()).map((r) => [r.sku, r.available])).toContainEqual([
      `T2-${run}`,
      4,
    ]);
  });

  it('updates and removes thresholds; stock list shows them; validates input', async () => {
    expect((await setThreshold(v3, 2)).body.data).toEqual({
      variantId: v3,
      threshold: 2,
    });
    expect((await setThreshold(v3, null)).status).toBe(200);
    expect((await low()).map((r) => r.sku)).not.toContain(`T3-${run}`);
    const levels = await http()
      .get('/api/v1/stock-levels')
      .query({ variant_id: v1 })
      .set(bearer(tokenA))
      .expect(200);
    expect(
      levels.body.data.map((l: { threshold: number | null }) => l.threshold),
    ).toEqual([6, 6]);
    expect((await setThreshold(v1, -1)).status).toBe(422);
    expect((await setThreshold(v1, 1.5)).status).toBe(422);
    expect((await setThreshold(randomUUID(), 1)).status).toBe(404);
  });

  it('another tenant can neither see nor set thresholds', async () => {
    expect(await low(tokenB)).toEqual([]);
    expect((await setThreshold(v1, 99, tokenB)).status).toBe(404);
  });
});
