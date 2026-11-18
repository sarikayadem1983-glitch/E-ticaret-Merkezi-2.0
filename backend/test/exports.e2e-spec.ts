import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { validate } from './../src/imports/product-csv.js';
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

describe('Exports (e2e, IMP-04)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`exp-a-${run}`, `exp-b-${run}`];
  let tokenA: string;
  let tokenB: string;
  let companyA: string;

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
    const csv = [
      'urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi',
      `Bardak ${run};B-${run}-1;;20;49,90;TRY`,
      `Bardak ${run};B-${run}-2;;20;49,90;TRY`,
    ].join('\n');
    await http()
      .post('/api/v1/imports/products')
      .set(bearer(tokenA))
      .send({ companyId: companyA, csv, dryRun: false })
      .expect(200);
    // A name a spreadsheet would run as a formula, created through the API.
    const v = (
      await http()
        .post('/api/v1/products')
        .set(bearer(tokenA))
        .send({
          companyId: companyA,
          name: `=HYPERLINK("x") ${run}`,
          variants: [{ sku: `F-${run}` }],
        })
        .expect(201)
    ).body.data.variants[0].id;
    const wh = (
      await http()
        .post('/api/v1/warehouses')
        .set(bearer(tokenA))
        .send({ companyId: companyA, name: 'Ana', isDefault: true })
        .expect(201)
    ).body.data.id;
    await http()
      .post('/api/v1/stock-movements')
      .set(bearer(tokenA))
      .send({ warehouseId: wh, variantId: v, quantity: 7, reason: 'opening' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('exports products in the import format, re-importable, formulas neutralised', async () => {
    const res = await http()
      .get('/api/v1/exports/products')
      .set(bearer(tokenA))
      .expect(200);
    const { csv, rows, filename } = res.body.data as {
      csv: string;
      rows: number;
      filename: string;
    };
    expect(rows).toBe(3);
    expect(filename).toMatch(/^urunler-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain(`B-${run}-1;;20;49,90;TRY`);
    expect(csv).toContain(`"'=HYPERLINK(""x"") ${run}"`);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines.every((l) => !/(^|;)[=+@]/.test(l))).toBe(true);
    // Without the formula row the file goes straight back into the importer.
    const reimport = validate(
      lines.filter((l) => !l.includes('HYPERLINK')).join('\n'),
    );
    expect(reimport.errors).toEqual([]);
    expect(reimport.products[0].variants).toHaveLength(2);
  });

  it('exports stock levels', async () => {
    const res = await http()
      .get('/api/v1/exports/stock')
      .set(bearer(tokenA))
      .expect(200);
    expect(res.body.data.rows).toBe(1);
    expect(res.body.data.csv).toContain(
      'urun_adi;sku;depo;eldeki;ayrilmis;kullanilabilir;esik',
    );
    expect(res.body.data.csv).toContain(`F-${run};Ana;7;0;7;`);
  });

  it('exports only the companies the member may read', async () => {
    const other = await http()
      .get('/api/v1/exports/products')
      .set(bearer(tokenB))
      .expect(200);
    expect(other.body.data.rows).toBe(0);
    const foreign = await http()
      .get('/api/v1/exports/products')
      .query({ company_id: companyA })
      .set(bearer(tokenB))
      .expect(200);
    expect(foreign.body.data.rows).toBe(0);
    expect(
      (
        await http()
          .get('/api/v1/exports/stock')
          .set(bearer(tokenB))
          .expect(200)
      ).body.data.rows,
    ).toBe(0);
    await http().get('/api/v1/exports/products').expect(401);
  });
});
