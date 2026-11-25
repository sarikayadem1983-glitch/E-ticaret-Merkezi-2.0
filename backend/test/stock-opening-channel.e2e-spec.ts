import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { InventoryService } from './../src/inventory/inventory.service.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  claims,
  createTestApp,
  purgeTenants,
  registerOwner,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));

describe('Stock opening from a channel read (e2e, INT-TY-02a)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`opn-a-${run}`];
  let token: string;
  let tenantId: string;
  let userId: string;
  let companyId: string;
  let variants: string[];
  let inventory: InventoryService;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    inventory = app.get(InventoryService);
    token = (
      await registerOwner(app, {
        tenantName: `Mağaza ${slugs[0]}`,
        tenantSlug: slugs[0],
        name: 'Sahip',
        email: `${slugs[0]}@test.local`,
        password: PASSWORD,
      })
    ).body.data.accessToken as string;
    ({ tid: tenantId, sub: userId } = claims(token));
    companyId = (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
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
    variants = (
      await http()
        .post('/api/v1/products')
        .set(bearer(token))
        .send({
          companyId,
          name: `Kalem ${run}`,
          variants: [{ sku: `O1-${run}` }, { sku: `O2-${run}` }],
        })
        .expect(201)
    ).body.data.variants.map((v: { id: string }) => v.id);
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  const open = (variantId: string, qty: number, actor: string | null) =>
    TenantContext.run(tenantId, () =>
      inventory.openingFromChannel(
        companyId,
        variantId,
        qty,
        randomUUID(),
        actor,
      ),
    );

  it('skips without a default warehouse, then seeds once', async () => {
    expect(await open(variants[0], 5, userId)).toBe('no_warehouse');
    await http()
      .post('/api/v1/warehouses')
      .set(bearer(token))
      .send({ companyId, name: 'Ana', isDefault: true })
      .expect(201);
    expect(await open(variants[0], 5, userId)).toBe('created');
    expect(await open(variants[0], 9, userId)).toBe('exists');
    expect(await open(variants[1], 0, userId)).toBe('zero');
    expect(await open(variants[1], 3, null)).toBe('created');
  });

  it('seeds exactly once under concurrent reads', async () => {
    const v = (
      await http()
        .post('/api/v1/products')
        .set(bearer(token))
        .send({
          companyId,
          name: `Silgi ${run}`,
          variants: [{ sku: `O3-${run}` }],
        })
        .expect(201)
    ).body.data.variants[0].id as string;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => open(v, 5, userId)),
    );
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'exists')).toHaveLength(4);
    const rows = (
      await http()
        .get(`/api/v1/stock-levels?variant_id=${v}`)
        .set(bearer(token))
        .expect(200)
    ).body.data as { variantId: string; onHand: number }[];
    const row = rows.find((r) => r.variantId === v);
    expect(row?.onHand).toBe(5);
  });
});
