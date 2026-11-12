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

interface Attr {
  id: string;
  values: { id: string; value: string }[];
}
interface Missing {
  code: string;
  attributeName?: string;
  variants?: string[];
}

const TREE = {
  categories: [
    { externalId: '1', name: 'Giyim', isLeaf: false },
    {
      externalId: '10',
      parentExternalId: '1',
      name: 'Tişört',
      isLeaf: true,
      attributes: [
        {
          externalId: 'renk',
          name: 'Renk',
          required: true,
          variesByVariant: true,
          allowCustom: false,
          values: [{ externalId: 'r1', name: 'Kırmızı' }],
        },
        {
          externalId: 'mensei',
          name: 'Menşei',
          required: true,
          variesByVariant: false,
          allowCustom: false,
          values: [
            { externalId: 'tr', name: 'TR' },
            { externalId: 'cn', name: 'CN' },
          ],
        },
        {
          externalId: 'not',
          name: 'Not',
          required: false,
          variesByVariant: false,
          allowCustom: true,
          values: [],
        },
      ],
    },
    { externalId: '11', parentExternalId: '1', name: 'Gömlek', isLeaf: true },
  ],
};

describe('Channel category mapping (e2e, CAT-06)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`map-a-${run}`, `map-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let categoryId: string;
  let colour: Attr;
  let productId: string;
  let attrIds: Record<string, string>;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const readiness = async (token = tokenA) =>
    (
      await http()
        .get(`/api/v1/products/${productId}/channel-readiness/trendyol`)
        .set(bearer(token))
        .expect(200)
    ).body.data as { ready: boolean; missing: Missing[] };
  const codes = (m: Missing[]) => m.map((x) => x.code);

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
    const companyId = (
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
    categoryId = (
      await http()
        .post('/api/v1/categories')
        .set(bearer(tokenA))
        .send({ name: 'Tişörtler', slug: `tisort-${run}` })
        .expect(201)
    ).body.data.id;
    colour = (
      await http()
        .post('/api/v1/attributes')
        .set(bearer(tokenA))
        .send({ name: `Renk ${run}`, values: ['Kırmızı', 'Mavi'] })
        .expect(201)
    ).body.data;
    productId = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId,
          categoryId,
          name: `Tişört ${run}`,
          variants: [
            {
              sku: `K-${run}`,
              attributes: [
                { attributeId: colour.id, valueId: colour.values[0].id },
              ],
            },
            { sku: `X-${run}` },
          ],
        })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('readiness reports an unmapped category before any tree exists', async () => {
    expect(codes((await readiness()).missing)).toEqual(['CATEGORY_NOT_MAPPED']);
  });

  it('rejects broken trees (unknown parent, cycle, leaf with children) and unknown channels', async () => {
    const bad = [
      [{ externalId: 'a', parentExternalId: 'zz', name: 'A', isLeaf: true }],
      [
        { externalId: 'a', parentExternalId: 'b', name: 'A', isLeaf: false },
        { externalId: 'b', parentExternalId: 'a', name: 'B', isLeaf: false },
      ],
      [
        { externalId: 'a', name: 'A', isLeaf: true },
        { externalId: 'b', parentExternalId: 'a', name: 'B', isLeaf: true },
      ],
    ];
    for (const categories of bad) {
      await http()
        .put('/api/v1/channel-categories/trendyol')
        .set(bearer(tokenA))
        .send({ categories })
        .expect(422);
    }
    await http()
      .put('/api/v1/channel-categories/amazon')
      .set(bearer(tokenA))
      .send(TREE)
      .expect(404);
  });

  it('imports a tree and lists it by level', async () => {
    const res = await http()
      .put('/api/v1/channel-categories/trendyol')
      .set(bearer(tokenA))
      .send(TREE)
      .expect(200);
    expect(res.body.data).toMatchObject({
      categories: 3,
      attributes: 3,
      removedCategories: 0,
    });
    const roots = await http()
      .get('/api/v1/channel-categories/trendyol')
      .set(bearer(tokenA))
      .expect(200);
    expect(
      roots.body.data.map((c: { externalId: string }) => c.externalId),
    ).toEqual(['1']);
    const kids = await http()
      .get('/api/v1/channel-categories/trendyol?parent=1')
      .set(bearer(tokenA))
      .expect(200);
    expect(kids.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Gömlek',
      'Tişört',
    ]);
    const attrs = await http()
      .get('/api/v1/channel-categories/trendyol/10/attributes')
      .set(bearer(tokenA))
      .expect(200);
    attrIds = Object.fromEntries(
      attrs.body.data.attributes.map(
        (a: { externalId: string; id: string }) => [a.externalId, a.id],
      ),
    );
    expect(Object.keys(attrIds).sort()).toEqual(['mensei', 'not', 'renk']);
  });

  it('maps only to leaf categories', async () => {
    await http()
      .put(`/api/v1/categories/${categoryId}/channel-mappings/trendyol`)
      .set(bearer(tokenA))
      .send({ channelCategoryExternalId: '1' })
      .expect(422);
    await http()
      .put(`/api/v1/categories/${categoryId}/channel-mappings/trendyol`)
      .set(bearer(tokenA))
      .send({ channelCategoryExternalId: '10' })
      .expect(200);
  });

  it('readiness lists the missing required attributes', async () => {
    const r = await readiness();
    expect(r.ready).toBe(false);
    expect(codes(r.missing).sort()).toEqual([
      'ATTRIBUTE_NOT_MAPPED',
      'VALUE_MISSING',
    ]);
  });

  it('maps the variant attribute; variants without a value are listed', async () => {
    await http()
      .put(`/api/v1/channel-attributes/${attrIds.mensei}/mapping`)
      .set(bearer(tokenA))
      .send({ attributeId: colour.id })
      .expect(422);
    await http()
      .put(`/api/v1/channel-attributes/${attrIds.renk}/mapping`)
      .set(bearer(tokenA))
      .send({ attributeId: colour.id })
      .expect(200);
    const r = await readiness();
    const variant = r.missing.find((m) => m.code === 'VARIANT_VALUE_MISSING');
    expect(variant?.variants).toEqual([`X-${run}`]);
  });

  it('validates product values against the allowed list', async () => {
    const url = `/api/v1/products/${productId}/channel-values/trendyol`;
    await http()
      .put(url)
      .set(bearer(tokenA))
      .send({
        values: [{ channelAttributeId: attrIds.mensei, valueExternalId: 'xx' }],
      })
      .expect(422);
    await http()
      .put(url)
      .set(bearer(tokenA))
      .send({
        values: [{ channelAttributeId: attrIds.mensei, value: 'Türkiye' }],
      })
      .expect(422);
    await http()
      .put(url)
      .set(bearer(tokenA))
      .send({
        values: [{ channelAttributeId: attrIds.renk, valueExternalId: 'r1' }],
      })
      .expect(422);
    const ok = await http()
      .put(url)
      .set(bearer(tokenA))
      .send({
        values: [
          { channelAttributeId: attrIds.mensei, valueExternalId: 'tr' },
          { channelAttributeId: attrIds.not, value: 'Pamuklu' },
        ],
      })
      .expect(200);
    expect(
      ok.body.data.values.map((v: { value: string }) => v.value).sort(),
    ).toEqual(['Pamuklu', 'TR']);
    expect(codes((await readiness()).missing)).toEqual([
      'VARIANT_VALUE_MISSING',
    ]);
  });

  it('a re-import that drops the mapped category invalidates the mapping', async () => {
    const res = await http()
      .put('/api/v1/channel-categories/trendyol')
      .set(bearer(tokenA))
      .send({
        categories: TREE.categories.filter((c) => c.externalId !== '10'),
      })
      .expect(200);
    expect(res.body.data.removedCategories).toBe(1);
    expect(codes((await readiness()).missing)).toEqual([
      'CHANNEL_CATEGORY_INVALID',
    ]);
    await http()
      .put('/api/v1/channel-categories/trendyol')
      .set(bearer(tokenA))
      .send(TREE)
      .expect(200);
    expect(codes((await readiness()).missing)).toEqual([
      'VARIANT_VALUE_MISSING',
    ]);
  });

  it('other tenants see nothing (404 / empty tree)', async () => {
    await http()
      .get(`/api/v1/products/${productId}/channel-readiness/trendyol`)
      .set(bearer(tokenB))
      .expect(404);
    const roots = await http()
      .get('/api/v1/channel-categories/trendyol')
      .set(bearer(tokenB))
      .expect(200);
    expect(roots.body.data).toEqual([]);
    await http()
      .put(`/api/v1/channel-attributes/${attrIds.renk}/mapping`)
      .set(bearer(tokenB))
      .send({ attributeId: colour.id })
      .expect(404);
  });
});
