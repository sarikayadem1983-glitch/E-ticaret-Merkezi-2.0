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
const uniqueVkn = () => vkn(String(Date.now() % 1e9).padStart(9, '0'));

interface Price {
  channel: string;
  amount: string;
  currency: string;
  netAmount: string | null;
  vatAmount: string | null;
}

describe('Catalog prices API (e2e, CAT-05)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`price-a-${run}`, `price-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let companyX: string;
  let productId: string;
  let variantId: string;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const priceUrl = (channel: string, v = variantId, p = productId) =>
    `/api/v1/products/${p}/variants/${v}/prices/${channel}`;

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

  beforeAll(async () => {
    app = await createTestApp();
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    tenantA = (await http().get('/api/v1/auth/me').set(bearer(tokenA))).body
      .data.tenantId;
    companyX = (
      await http()
        .post('/api/v1/companies')
        .set(bearer(tokenA))
        .send({
          legalName: `X ${run}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('creates a product with VAT rate and variant prices; derives net and VAT', async () => {
    const res = await http()
      .post('/api/v1/products')
      .set(bearer(tokenA))
      .send({
        companyId: companyX,
        name: `Kupa ${run}`,
        vatRate: '20',
        variants: [
          {
            sku: `KUPA-${run}`,
            prices: [
              { channel: 'trendyol', amount: '219.90', currency: 'TRY' },
              { channel: 'list', amount: '199.90', currency: 'TRY' },
            ],
          },
        ],
      })
      .expect(201);
    productId = res.body.data.id;
    variantId = res.body.data.variants[0].id;
    expect(res.body.data.vatRate).toBe('20.00');
    const prices = res.body.data.variants[0].prices as Price[];
    expect(
      prices.map((p) => [p.channel, p.amount, p.netAmount, p.vatAmount]),
    ).toEqual([
      ['list', '199.90', '166.58', '33.32'],
      ['trendyol', '219.90', '183.25', '36.65'],
    ]);
  });

  it('rejects floats, too many decimals, unknown currency and VAT rate', async () => {
    for (const body of [
      { amount: 199.9, currency: 'TRY' },
      { amount: '199.999', currency: 'TRY' },
      { amount: '1,50', currency: 'TRY' },
      { amount: '-1', currency: 'TRY' },
      { amount: '10', currency: 'GBP' },
    ]) {
      await http()
        .put(priceUrl('list'))
        .set(bearer(tokenA))
        .send(body)
        .expect(422);
    }
    await http()
      .patch(`/api/v1/products/${productId}`)
      .set(bearer(tokenA))
      .send({ vatRate: '18' })
      .expect(422);
    const dup = await http()
      .post(`/api/v1/products/${productId}/variants`)
      .set(bearer(tokenA))
      .send({
        sku: `KUPA2-${run}`,
        prices: [
          { channel: 'list', amount: '1', currency: 'TRY' },
          { channel: 'list', amount: '2', currency: 'TRY' },
        ],
      })
      .expect(422);
    expect(dup.body.error.code).toBe('PRICE_CHANNEL_DUPLICATE');
    await http()
      .put(priceUrl('Bad_Code'))
      .set(bearer(tokenA))
      .send({ amount: '1', currency: 'TRY' })
      .expect(404);
  });

  it('upserts a channel price, recalculates on VAT change, deletes softly, audits', async () => {
    const created = await http()
      .put(priceUrl('hepsiburada'))
      .set(bearer(tokenA))
      .send({ amount: '100', currency: 'TRY' })
      .expect(200);
    expect(
      (created.body.data.prices as Price[]).find(
        (p) => p.channel === 'hepsiburada',
      ),
    ).toMatchObject({
      amount: '100.00',
      netAmount: '83.33',
      vatAmount: '16.67',
    });
    await http()
      .put(priceUrl('hepsiburada'))
      .set(bearer(tokenA))
      .send({ amount: '0.03', currency: 'TRY' })
      .expect(200);

    const patched = await http()
      .patch(`/api/v1/products/${productId}`)
      .set(bearer(tokenA))
      .send({ vatRate: '10' })
      .expect(200);
    const hb = (patched.body.data.variants[0].prices as Price[]).find(
      (p) => p.channel === 'hepsiburada',
    );
    // 0.03 / 1.10 = 0.0272… → 0.03 (half-up), VAT 0.00
    expect(hb).toMatchObject({
      amount: '0.03',
      netAmount: '0.03',
      vatAmount: '0.00',
    });

    const cleared = await http()
      .patch(`/api/v1/products/${productId}`)
      .set(bearer(tokenA))
      .send({ vatRate: null })
      .expect(200);
    expect(cleared.body.data.vatRate).toBeNull();
    expect(cleared.body.data.variants[0].prices[0].netAmount).toBeNull();

    await http()
      .delete(priceUrl('hepsiburada'))
      .set(bearer(tokenA))
      .expect(204);
    await http()
      .delete(priceUrl('hepsiburada'))
      .set(bearer(tokenA))
      .expect(404);
    // Re-adding after a soft delete works (partial unique index).
    await http()
      .put(priceUrl('hepsiburada'))
      .set(bearer(tokenA))
      .send({ amount: '5', currency: 'EUR' })
      .expect(200);

    const pool = ownerPool();
    try {
      const { rows } = await pool.query<{
        action: string;
        after: { amount?: string } | null;
      }>(
        `SELECT action, after FROM audit_logs WHERE tenant_id = $1 AND entity_type = 'VariantPrice'
         ORDER BY created_at`,
        [tenantA],
      );
      expect(rows.map((r) => r.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
        'CREATE',
      ]);
      expect(rows[1].after?.amount).toBe('0.03');
    } finally {
      await pool.end();
    }
  });

  it('another tenant cannot read or write the prices (404)', async () => {
    await http()
      .put(priceUrl('list'))
      .set(bearer(tokenB))
      .send({ amount: '1', currency: 'TRY' })
      .expect(404);
    await http().delete(priceUrl('list')).set(bearer(tokenB)).expect(404);
    await http()
      .get(`/api/v1/products/${productId}`)
      .set(bearer(tokenB))
      .expect(404);
  });
});
