import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { createTestApp, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const H = 'urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Product import (e2e, IMP-01)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`imp-a-${run}`, `imp-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;

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
  const post = (
    csv: string,
    dryRun?: boolean,
    token = tokenA,
    companyId?: string,
  ) =>
    http()
      .post('/api/v1/imports/products')
      .set(bearer(token))
      .send({
        companyId: companyId ?? companyA,
        csv,
        ...(dryRun === undefined ? {} : { dryRun }),
      });
  const count = async () =>
    (
      await http()
        .get('/api/v1/products')
        .query({ company_id: companyA })
        .set(bearer(tokenA))
        .expect(200)
    ).body.meta.total as number;

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
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('serves the CSV template', async () => {
    const res = await http()
      .get('/api/v1/imports/products/template')
      .set(bearer(tokenA))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(H);
  });

  const good = [
    H,
    `Kupa ${run};KP-${run}-1;;20;149,90;TRY`,
    `Kupa ${run};KP-${run}-2;;20;149,90;TRY`,
    `Defter ${run};DF-${run};869${run.replace(/\D/g, '0').slice(0, 7)}0;10;;`,
  ].join('\r\n');

  it('dry run is the default and writes nothing', async () => {
    const before = await count();
    const res = await post(good).expect(200);
    expect(res.body.data).toMatchObject({
      rows: 3,
      products: 2,
      variants: 3,
      errors: [],
      dryRun: true,
      created: 0,
    });
    expect(await count()).toBe(before);
  });

  it('a real run creates grouped products with prices; a second run reports taken SKUs', async () => {
    const before = await count();
    const res = await post(good, false).expect(200);
    expect(res.body.data).toMatchObject({ created: 2, dryRun: false });
    expect(await count()).toBe(before + 2);
    const list = await http()
      .get('/api/v1/products')
      .query({ company_id: companyA, search: `Kupa ${run}` })
      .set(bearer(tokenA))
      .expect(200);
    const kupa = list.body.data[0];
    expect(kupa.vatRate).toBe('20.00');
    expect(kupa.variants.map((v: { sku: string }) => v.sku).sort()).toEqual([
      `KP-${run}-1`,
      `KP-${run}-2`,
    ]);
    expect(kupa.variants[0].prices).toEqual([
      expect.objectContaining({
        channel: 'list',
        amount: '149.90',
        currency: 'TRY',
      }),
    ]);

    const again = await post(
      good
        .toLowerCase()
        .replace('urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi', H),
      false,
    ).expect(200);
    expect(again.body.data.created).toBe(0);
    expect(
      again.body.data.errors.map((e: { row: number; column: string }) => [
        e.row,
        e.column,
      ]),
    ).toEqual([
      [2, 'sku'],
      [3, 'sku'],
      [4, 'sku'],
      [4, 'barkod'],
    ]);
  });

  it('reports bad rows by row and column and blocks formula cells', async () => {
    const before = await count();
    const res = await post(
      [
        H,
        `=cmd|' /C calc'!A0;X-${run};;;;`,
        `Ok ${run};;;;;`,
        `Ok2 ${run};O2-${run};;5;;`,
      ].join('\n'),
      false,
    ).expect(200);
    expect(
      res.body.data.errors.map((e: { row: number; column: string }) => [
        e.row,
        e.column,
      ]),
    ).toEqual([
      [2, 'urun_adi'],
      [3, 'sku'],
      [4, 'kdv_orani'],
    ]);
    expect(res.body.data.errors[0].message).toContain('formül');
    expect(res.body.data.created).toBe(0);
    expect(await count()).toBe(before);
  });

  it('another tenant cannot import into this company; oversized input is refused', async () => {
    await post(good, true, tokenB).expect(404);
    await post(good, true, tokenA, randomUUID()).expect(404);
    expect((await post('x'.repeat(96_000))).status).toBe(422);
  });
});
