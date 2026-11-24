import { describe, expect, it, vi } from 'vitest';
import { priceString } from '../channels/trendyol.adapter.js';
import { emptyStats, type SyncContext } from '../sync/sync.types.js';
import { TrendyolStockPriceSync } from './trendyol-stock-price.sync.js';

const item = (
  barcode: string,
  quantity: number | null,
  salePrice: string | null,
) => ({
  barcode,
  stockCode: null,
  title: 'T',
  productMainId: null,
  approved: true,
  lastUpdateDate: null,
  vatRate: 20,
  quantity,
  salePrice,
});

describe('priceString', () => {
  it('formats valid prices, rejects others', () => {
    expect(priceString(199.9)).toBe('199.90');
    expect(priceString(0)).toBe('0.00');
    expect(priceString(10.005)).toBe('10.01');
    expect(priceString(-1)).toBeNull();
    expect(priceString('5')).toBeNull();
    expect(priceString(Number.NaN)).toBeNull();
  });
});

function setup(
  items: ReturnType<typeof item>[],
  opening: string,
  liveCallsAllowed = true,
) {
  const adapter = {
    listProducts: vi.fn(() => Promise.resolve({ items, totalPages: 1 })),
  };
  const products = {
    setPriceFromChannel: vi.fn(() => Promise.resolve('created')),
  };
  const inventory = {
    openingFromChannel: vi.fn(() => Promise.resolve(opening)),
  };
  const ctx = {
    companyId: 'c',
    channel: 'trendyol',
    syncJobId: 'j',
    credentials: {},
    liveCallsAllowed,
    stats: emptyStats(),
    takeRate: vi.fn(() => Promise.resolve()),
    claim: vi.fn((i: { externalId: string }) =>
      Promise.resolve({
        decision: 'unchanged',
        refId: `ref-${i.externalId}`,
        localId: i.externalId === 'linked' ? 'v1' : null,
        needsImport: false,
      }),
    ),
  } as unknown as SyncContext;
  const svc = new TrendyolStockPriceSync(
    { registerKind: vi.fn() } as never,
    products as never,
    inventory as never,
    adapter as never,
  );
  return { svc, ctx, products, inventory };
}

describe('TrendyolStockPriceSync.run', () => {
  const actor = '11111111-1111-4111-8111-111111111111';

  it('sets the trendyol price and seeds stock only for linked variants', async () => {
    const { svc, ctx, products, inventory } = setup(
      [item('linked', 7, '99.90'), item('other', 3, '10.00')],
      'created',
    );
    await svc.run(ctx, actor);
    expect(products.setPriceFromChannel).toHaveBeenCalledExactlyOnceWith(
      'c',
      'v1',
      'trendyol',
      '99.90',
      'TRY',
      actor,
    );
    expect(inventory.openingFromChannel).toHaveBeenCalledExactlyOnceWith(
      'c',
      'v1',
      7,
      'j',
      actor,
    );
    expect(ctx.stats).toMatchObject({
      skipped: 1,
      pricesSet: 1,
      stockSeeded: 1,
    });
  });

  it('keeps existing local stock and counts it', async () => {
    const { svc, ctx } = setup([item('linked', 7, null)], 'exists');
    await svc.run(ctx, actor);
    expect(ctx.stats.stockKept).toBe(1);
    expect(ctx.stats.stockSeeded).toBeUndefined();
  });

  it('counts a missing default warehouse as skipped, does not fail', async () => {
    const { svc, ctx } = setup([item('linked', 7, null)], 'no_warehouse');
    await svc.run(ctx, actor);
    expect(ctx.stats.skipped).toBe(1);
  });

  it('refuses when live calls are off', async () => {
    const { svc, ctx } = setup([], 'created', false);
    await expect(svc.run(ctx, actor)).rejects.toMatchObject({
      code: 'SYNC_LIVE_CALLS_DISABLED',
    });
  });
});
