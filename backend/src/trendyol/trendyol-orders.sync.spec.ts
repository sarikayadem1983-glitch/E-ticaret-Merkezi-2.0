import { describe, expect, it, vi } from 'vitest';
import { parsePackagePage } from '../channels/trendyol.adapter.js';
import { emptyStats, type SyncContext } from '../sync/sync.types.js';
import {
  packageHash,
  parseOrdersPayload,
  TrendyolOrdersSync,
} from './trendyol-orders.sync.js';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 3001,
  orderNumber: '10001',
  shipmentPackageStatus: 'Created',
  orderDate: 1_764_000_000_000,
  lastModifiedDate: 1_764_000_100_000,
  currencyCode: 'TRY',
  grossAmount: 200,
  totalDiscount: 20,
  totalTyDiscount: 5,
  totalPrice: 175,
  lines: [
    {
      id: 501,
      barcode: 'B1',
      merchantSku: 'SKU1',
      productName: 'Kalem',
      quantity: 2,
      amount: 100,
      discount: 20,
      price: 90,
      vatBaseAmount: 20,
    },
  ],
  ...over,
});

describe('parsePackagePage', () => {
  it('maps a package and its lines', () => {
    const page = parsePackagePage({ content: [raw()], totalPages: 1 });
    expect(page.invalid).toBe(0);
    const p = page.items[0];
    expect(p).toMatchObject({
      packageId: '3001',
      orderNumber: '10001',
      status: 'created',
      currency: 'TRY',
      subtotal: '200.00',
      discountTotal: '20.00',
      channelDiscountTotal: '5.00',
      total: '175.00',
    });
    expect(p.lines[0]).toEqual({
      externalLineId: '501',
      barcode: 'B1',
      sku: 'SKU1',
      name: 'Kalem',
      quantity: 2,
      unitPrice: '100.00',
      discount: '20.00',
      vatRate: '20.00',
      lineTotal: '180.00',
    });
  });

  it('maps every Trendyol status, case-insensitive', () => {
    const page = parsePackagePage({
      content: [
        raw({ shipmentPackageStatus: 'AtCollectionPoint' }),
        raw({ shipmentPackageStatus: 'UnDelivered' }),
        raw({ shipmentPackageStatus: 'UnSupplied' }),
      ],
    });
    expect(page.items.map((i) => i.status)).toEqual([
      'at_collection_point',
      'undelivered',
      'unsupplied',
    ]);
  });

  it('counts invalid packages instead of failing', () => {
    const page = parsePackagePage({
      content: [
        raw({ shipmentPackageStatus: 'Teleported' }),
        raw({ lines: [] }),
        raw({ totalPrice: -1 }),
        raw({ lines: [{ id: 1, quantity: 0, amount: 1, price: 1 }] }),
        null,
        raw(),
      ],
    });
    expect(page.invalid).toBe(5);
    expect(page.items).toHaveLength(1);
  });

  it('rejects a body without content', () => {
    expect(() => parsePackagePage({})).toThrow();
  });
});

describe('parseOrdersPayload', () => {
  it('accepts 1–14 days only', () => {
    expect(parseOrdersPayload({ days: 14 })).toEqual({ days: 14 });
    for (const bad of [{ days: 0 }, { days: 15 }, { days: 1.5 }, {}, null]) {
      expect(() => parseOrdersPayload(bad)).toThrow();
    }
  });
});

describe('packageHash', () => {
  it('changes with the status', () => {
    const [a] = parsePackagePage({ content: [raw()] }).items;
    const [b] = parsePackagePage({
      content: [raw({ shipmentPackageStatus: 'Shipped' })],
    }).items;
    expect(packageHash(a)).not.toBe(packageHash(b));
  });
});

function setup(result: string, liveCallsAllowed = true) {
  const page = parsePackagePage({ content: [raw()], totalPages: 1 });
  const adapter = {
    listShipmentPackages: vi.fn(() => Promise.resolve(page)),
  };
  const orders = {
    applyChannelPackage: vi.fn(
      async (
        _pkg: unknown,
        deps: { claim: (tx: unknown) => Promise<unknown> },
      ) => {
        await deps.claim({});
        return result;
      },
    ),
  };
  const refs = {
    localIdsByExternal: vi.fn(() => Promise.resolve(new Map([['B1', 'v1']]))),
  };
  const stats = emptyStats();
  const ctx = {
    companyId: 'c',
    channelAccountId: 'acc',
    channel: 'trendyol',
    syncJobId: 'j',
    credentials: {},
    liveCallsAllowed,
    stats,
    takeRate: vi.fn(() => Promise.resolve()),
    claim: vi.fn(() => {
      stats.processed += 1;
      stats.updated += 1;
      return Promise.resolve({
        decision: 'updated',
        refId: 'r',
        localId: 'o1',
        needsImport: false,
      });
    }),
    linkLocal: vi.fn(),
  } as unknown as SyncContext;
  const svc = new TrendyolOrdersSync(
    { registerKind: vi.fn() } as never,
    orders as never,
    refs as never,
    adapter as never,
  );
  return { svc, ctx, orders, adapter, refs };
}

describe('TrendyolOrdersSync', () => {
  it('refuses to run without live calls', async () => {
    const { svc, ctx, adapter } = setup('created', false);
    await expect(svc.run(ctx, 3)).rejects.toThrow();
    expect(adapter.listShipmentPackages).not.toHaveBeenCalled();
  });

  it('queries the window and passes the package with matched variants', async () => {
    const { svc, ctx, orders, adapter } = setup('created');
    const now = new Date('2026-11-27T12:00:00Z');
    await svc.run(ctx, 3, now);
    const [, start, end] = adapter.listShipmentPackages.mock
      .calls[0] as unknown as [unknown, Date, Date];
    expect(end).toEqual(now);
    expect(now.getTime() - start.getTime()).toBe(3 * 86_400_000);
    const [pkg, deps] = orders.applyChannelPackage.mock.calls[0] as unknown as [
      { externalOrderNo: string; channelAccountId: string },
      { variantIdsByBarcode: Map<string, string> },
    ];
    expect(pkg.externalOrderNo).toBe('10001/3001');
    expect(pkg.channelAccountId).toBe('acc');
    expect(deps.variantIdsByBarcode.get('B1')).toBe('v1');
  });

  it('undoes claim counters when the status change is refused', async () => {
    const { svc, ctx } = setup('status_refused');
    await svc.run(ctx, 1);
    expect(ctx.stats).toMatchObject({
      processed: 0,
      updated: 0,
      statusRefused: 1,
    });
  });

  it('counts status changes and unreserved new orders', async () => {
    const a = setup('status_changed');
    await a.svc.run(a.ctx, 1);
    expect(a.ctx.stats.statusChanged).toBe(1);
    const b = setup('created_unreserved');
    await b.svc.run(b.ctx, 1);
    expect(b.ctx.stats).toMatchObject({ unreserved: 1, linesUnmatched: 0 });
  });
});
