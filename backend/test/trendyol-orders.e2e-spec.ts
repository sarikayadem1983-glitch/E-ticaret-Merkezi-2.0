import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import type { OrderStatus } from './../src/orders/order-status.js';
import {
  OrdersService,
  type ChannelPackage,
} from './../src/orders/orders.service.js';
import { ExternalRefsRepository } from './../src/sync/external-refs.repository.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  claims,
  createTestApp,
  purgeTenants,
  registerOwner,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const CREDS = {
  supplierId: '987650',
  apiKey: 'ak-tyo-abcdefgh-1111',
  apiSecret: 'as-tyo-zyxwvuts-2222',
};

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Trendyol order import (e2e, INT-TY-03a)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`tyo-a-${run}`];
  let token: string;
  let tenantId: string;
  let companyId: string;
  let accountId: string;
  let variantId: string;
  let syncJobId: string;
  let orders: OrdersService;
  let refs: ExternalRefsRepository;

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const asT = <T>(fn: () => Promise<T>) => TenantContext.run(tenantId, fn);
  const barcode = () => `TYB-${run}`;

  const pkg = (
    packageId: string,
    status: OrderStatus,
    lineBarcode = barcode(),
  ): ChannelPackage => ({
    companyId,
    channel: 'trendyol',
    channelAccountId: accountId,
    externalOrderNo: `9${run}/${packageId}`,
    status,
    currency: 'TRY',
    subtotal: '200.00',
    discountTotal: '20.00',
    channelDiscountTotal: '0.00',
    total: '180.00',
    orderedAt: new Date('2026-11-27T10:00:00Z'),
    lines: [
      {
        externalLineId: `L-${packageId}`,
        barcode: lineBarcode,
        sku: 'X',
        name: 'Kalem',
        quantity: 2,
        unitPrice: '100.00',
        discount: '20.00',
        vatRate: '20.00',
        lineTotal: '180.00',
      },
    ],
  });

  const apply = (p: ChannelPackage) =>
    asT(async () =>
      orders.applyChannelPackage(p, {
        claim: (tx) =>
          refs.claim(
            {
              channelAccountId: accountId,
              entityType: 'order',
              externalId: `${run}-${p.externalOrderNo.split('/')[1]}`,
              externalUpdatedAt: null,
              payloadHash: sha(p.status),
              syncJobId,
            },
            tx,
          ),
        link: (refId, localId, tx) =>
          refs.linkLocal(accountId, refId, localId, tx),
        variantIdsByBarcode: await refs.localIdsByExternal(
          accountId,
          'variant',
          p.lines.flatMap((l) => (l.barcode ? [l.barcode] : [])),
        ),
        syncJobId,
      }),
    );

  const level = async () => {
    const rows = (
      await http()
        .get(`/api/v1/stock-levels?variant_id=${variantId}`)
        .set(bearer(token))
        .expect(200)
    ).body.data as { onHand: number; reserved: number }[];
    return rows[0];
  };
  const byNo = async (packageId: string) =>
    (
      await http()
        .get('/api/v1/orders')
        .query({ search: `9${run}/${packageId}` })
        .set(bearer(token))
        .expect(200)
    ).body.data as { id: string; status: string; channel: string }[];
  const detail = async (id: string) =>
    (await http().get(`/api/v1/orders/${id}`).set(bearer(token)).expect(200))
      .body.data;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.get(OrdersService);
    refs = app.get(ExternalRefsRepository);
    const prisma = app.get<TenantPrismaClient>(PRISMA);
    token = (
      await registerOwner(app, {
        tenantName: `Mağaza ${slugs[0]}`,
        tenantSlug: slugs[0],
        name: 'Sahip',
        email: `${slugs[0]}@test.local`,
        password: PASSWORD,
      })
    ).body.data.accessToken as string;
    ({ tid: tenantId } = claims(token));
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
    accountId = (
      await http()
        .post(`/api/v1/companies/${companyId}/channel-accounts`)
        .set(bearer(token))
        .send({ channel: 'trendyol', name: `TY ${run}`, credentials: CREDS })
        .expect(201)
    ).body.data.id;
    variantId = (
      await http()
        .post('/api/v1/products')
        .set(bearer(token))
        .send({
          companyId,
          name: `Kalem ${run}`,
          variants: [{ sku: `TY1-${run}`, barcode: barcode() }],
        })
        .expect(201)
    ).body.data.variants[0].id;
    const warehouseId = (
      await http()
        .post('/api/v1/warehouses')
        .set(bearer(token))
        .send({ companyId, name: 'Ana', isDefault: true })
        .expect(201)
    ).body.data.id as string;
    await http()
      .post('/api/v1/stock-movements')
      .set(bearer(token))
      .send({ warehouseId, variantId, quantity: 10, reason: 'opening' })
      .expect(201);
    syncJobId = await asT(async () => {
      const job = await prisma.syncJob.create({
        data: {
          tenantId,
          companyId,
          channelAccountId: accountId,
          kind: 'trendyol.orders.pull',
          idempotencyKey: `test-${run}`,
        },
        select: { id: true },
      });
      const ref = await refs.claim({
        channelAccountId: accountId,
        entityType: 'variant',
        externalId: barcode(),
        externalUpdatedAt: null,
        payloadHash: sha('v'),
        syncJobId: job.id,
      });
      await refs.linkLocal(accountId, ref.refId, variantId);
      return job.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  it('imports a package once, matched and reserved', async () => {
    expect(await apply(pkg('P1', 'created'))).toBe('created');
    expect(await apply(pkg('P1', 'created'))).toBe('unchanged');
    const found = await byNo('P1');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ status: 'created', channel: 'trendyol' });
    expect(await level()).toMatchObject({ onHand: 10, reserved: 2 });
    const d = await detail(found[0].id);
    expect(d.items[0]).toMatchObject({ variantId, lineTotal: '180.00' });
    expect(d.statusHistory[0]).toMatchObject({ source: 'channel' });
  });

  it('a channel cancel releases the reservation', async () => {
    expect(await apply(pkg('P1', 'cancelled'))).toBe('status_changed');
    expect(await level()).toMatchObject({ onHand: 10, reserved: 0 });
    expect((await byNo('P1'))[0].status).toBe('cancelled');
  });

  it('a refused transition changes nothing and is retried', async () => {
    expect(await apply(pkg('P1', 'shipped'))).toBe('status_refused');
    expect((await byNo('P1'))[0].status).toBe('cancelled');
    expect(await apply(pkg('P1', 'shipped'))).toBe('status_refused');
  });

  it('shipping consumes stock; an order first seen delivered does not', async () => {
    expect(await apply(pkg('P2', 'created'))).toBe('created');
    expect(await apply(pkg('P2', 'shipped'))).toBe('status_changed');
    expect(await level()).toMatchObject({ onHand: 8, reserved: 0 });
    expect(await apply(pkg('P3', 'delivered'))).toBe('created');
    expect(await level()).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('an unmatched line imports without a variant', async () => {
    expect(await apply(pkg('P4', 'created', `NONE-${run}`))).toBe('created');
    const [o] = await byNo('P4');
    expect((await detail(o.id)).items[0].variantId).toBeNull();
    expect(await level()).toMatchObject({ onHand: 8, reserved: 0 });
  });

  it('starting a pull validates days', async () => {
    await http()
      .post(
        `/api/v1/companies/${companyId}/channel-accounts/${accountId}/trendyol/orders-pull`,
      )
      .set(bearer(token))
      .send({ days: 30 })
      .expect(422);
  });
});
