import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBatchResult } from '../channels/trendyol.adapter.js';
import { emptyStats, type SyncContext } from '../sync/sync.types.js';
import {
  parsePushPayload,
  TrendyolStockPricePush,
} from './trendyol-stock-price-push.sync.js';

const A = '11111111-1111-4111-8111-111111111111';
const V1 = '22222222-2222-4222-8222-222222222222';
const V2 = '33333333-3333-4333-8333-333333333333';
const V3 = '44444444-4444-4444-8444-444444444444';

const remote = (barcode: string, sale: string | null, list: string | null) => ({
  barcode,
  stockCode: null,
  title: 'T',
  productMainId: null,
  approved: true,
  lastUpdateDate: null,
  vatRate: 20,
  quantity: 1,
  salePrice: sale,
  listPrice: list,
});

function setup(opts: {
  available?: Map<string, number> | null;
  live?: boolean;
  batch?: ReturnType<typeof parseBatchResult>[];
}) {
  const batches = [...(opts.batch ?? [])];
  const adapter = {
    findByBarcode: vi.fn((_c: unknown, b: string) =>
      Promise.resolve(
        b === 'B1'
          ? remote('B1', '100.00', '150.00')
          : b === 'B2'
            ? remote('B2', '80.00', null)
            : null,
      ),
    ),
    updatePriceAndInventory: vi.fn(() => Promise.resolve('batch-1')),
    getBatchResult: vi.fn(() =>
      Promise.resolve(batches.shift() ?? { completed: false, items: [] }),
    ),
  };
  const inventory = {
    availableTotals: vi.fn(() =>
      Promise.resolve(
        opts.available === undefined
          ? new Map([
              [V1, 7],
              [V2, 0],
              [V3, 4],
            ])
          : opts.available,
      ),
    ),
  };
  const products = {
    channelPrices: vi.fn(() => Promise.resolve(new Map([[V1, '200.00']]))),
  };
  const refs = {
    externalIdsByLocal: vi.fn(() =>
      Promise.resolve(
        new Map([
          [V1, 'B1'],
          [V2, 'B2'],
          [V3, 'B3'],
        ]),
      ),
    ),
  };
  const ctx = {
    companyId: 'c',
    channelAccountId: 'acc',
    channel: 'trendyol',
    syncJobId: 'j',
    credentials: {},
    liveCallsAllowed: opts.live ?? true,
    stats: emptyStats(),
    takeRate: vi.fn(() => Promise.resolve()),
  } as unknown as SyncContext;
  const handler = new TrendyolStockPricePush(
    { registerKind: vi.fn() } as never,
    products as never,
    inventory as never,
    refs as never,
    adapter as never,
  );
  return { handler, ctx, adapter };
}

afterEach(() => vi.useRealTimers());

describe('parsePushPayload', () => {
  it('accepts 1–50 unique uuids', () => {
    expect(parsePushPayload({ actorUserId: A, variantIds: [V1] })).toEqual({
      actorUserId: A,
      variantIds: [V1],
    });
  });
  it.each([
    { actorUserId: A, variantIds: [] },
    { actorUserId: A, variantIds: [V1, V1] },
    { actorUserId: A, variantIds: ['x'] },
    { actorUserId: A, variantIds: Array.from({ length: 51 }, () => V1) },
    { actorUserId: A, variantIds: [V1], extra: 1 },
    { actorUserId: 'x', variantIds: [V1] },
  ])('rejects %o', (raw) => {
    expect(() => parsePushPayload(raw)).toThrow('SYNC_INVALID_PAYLOAD');
  });
});

describe('parseBatchResult', () => {
  it('reads per-item status, drops failure texts', () => {
    const r = parseBatchResult({
      status: 'COMPLETED',
      items: [
        { requestItem: { barcode: 'B1' }, status: 'SUCCESS' },
        {
          requestItem: { barcode: 'B2' },
          status: 'FAILED',
          failureReasons: ['secret text'],
        },
      ],
    });
    expect(r).toEqual({
      completed: true,
      items: [
        { barcode: 'B1', status: 'SUCCESS' },
        { barcode: 'B2', status: 'FAILED' },
      ],
    });
  });
  it('is not completed while items are pending', () => {
    expect(
      parseBatchResult({
        status: 'IN_PROGRESS',
        items: [{ requestItem: { barcode: 'B1' }, status: '' }],
      }).completed,
    ).toBe(false);
  });
});

describe('TrendyolStockPricePush', () => {
  it('sends local stock and price, keeps Trendyol list price, records the batch result', async () => {
    vi.useFakeTimers();
    const { handler, ctx, adapter } = setup({
      batch: [
        { completed: false, items: [] },
        {
          completed: true,
          items: [
            { barcode: 'B1', status: 'SUCCESS' },
            { barcode: 'B2', status: 'FAILED' },
          ],
        },
      ],
    });
    const run = handler.run(ctx, [V1, V2, V3]);
    await vi.runAllTimersAsync();
    await run;
    expect(adapter.updatePriceAndInventory).toHaveBeenCalledWith({}, [
      // local price 200 > Trendyol list 150 → list raised to 200
      { barcode: 'B1', quantity: 7, salePrice: 200, listPrice: 200 },
      // no local price → Trendyol's sale price, list = sale
      { barcode: 'B2', quantity: 0, salePrice: 80, listPrice: 80 },
    ]);
    // B3 unknown to Trendyol → skipped
    expect(ctx.stats).toMatchObject({
      processed: 3,
      skipped: 1,
      pushSent: 2,
      pushSucceeded: 1,
      pushFailed: 1,
    });
  });

  it('keeps a higher Trendyol list price', async () => {
    vi.useFakeTimers();
    const { handler, ctx, adapter } = setup({
      batch: [
        { completed: true, items: [{ barcode: 'B1', status: 'SUCCESS' }] },
      ],
    });
    (
      handler as unknown as { products: { channelPrices: unknown } }
    ).products.channelPrices = vi.fn(() =>
      Promise.resolve(new Map([[V1, '120.00']])),
    );
    const run = handler.run(ctx, [V1]);
    await vi.runAllTimersAsync();
    await run;
    expect(adapter.updatePriceAndInventory).toHaveBeenCalledWith({}, [
      { barcode: 'B1', quantity: 7, salePrice: 120, listPrice: 150 },
    ]);
  });

  it('marks unconfirmed items as pending', async () => {
    vi.useFakeTimers();
    const { handler, ctx } = setup({});
    const run = handler.run(ctx, [V1]);
    await vi.runAllTimersAsync();
    await run;
    expect(ctx.stats).toMatchObject({ pushSent: 1, pushPending: 1 });
  });

  it('refuses without live calls or stock tracking, sends nothing', async () => {
    const off = setup({ live: false });
    await expect(off.handler.run(off.ctx, [V1])).rejects.toThrow(
      'SYNC_LIVE_CALLS_DISABLED',
    );
    const noStock = setup({ available: null });
    await expect(noStock.handler.run(noStock.ctx, [V1])).rejects.toThrow(
      'STOCK_NOT_TRACKED',
    );
    expect(off.adapter.updatePriceAndInventory).not.toHaveBeenCalled();
    expect(noStock.adapter.updatePriceAndInventory).not.toHaveBeenCalled();
  });

  it('writes nothing when no variant is linked and known', async () => {
    const { handler, ctx, adapter } = setup({});
    await handler.run(ctx, [V3]);
    expect(adapter.updatePriceAndInventory).not.toHaveBeenCalled();
    expect(ctx.stats).toMatchObject({ processed: 1, skipped: 1 });
  });
});
