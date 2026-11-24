import { describe, expect, it, vi } from 'vitest';
import { parseProductPage } from '../channels/trendyol.adapter.js';
import { SyncError } from '../sync/sync-errors.js';
import { emptyStats, type SyncContext } from '../sync/sync.types.js';
import {
  TrendyolProductsSync,
  parsePullPayload,
  pickMatches,
  productHash,
} from './trendyol-products.sync.js';

const item = (barcode: string, stockCode: string | null = null) => ({
  barcode,
  stockCode,
  title: 'T',
  productMainId: null,
  approved: true,
  lastUpdateDate: null,
});

describe('parseProductPage', () => {
  it('keeps only known fields and skips items without barcode', () => {
    const page = parseProductPage({
      totalPages: 3,
      content: [
        {
          barcode: ' 869 ',
          stockCode: 'SKU-1',
          lastUpdateDate: 1700000000000,
          secret: 'x',
        },
        { stockCode: 'no-barcode' },
        null,
      ],
    });
    expect(page.totalPages).toBe(3);
    expect(page.items).toEqual([
      {
        barcode: '869',
        stockCode: 'SKU-1',
        title: null,
        productMainId: null,
        approved: null,
        lastUpdateDate: new Date(1700000000000),
      },
    ]);
  });

  it('rejects a body without content', () => {
    expect(() => parseProductPage({})).toThrow(SyncError);
    expect(() => parseProductPage(null)).toThrow(SyncError);
  });

  it('clamps bad totalPages to 0', () => {
    expect(parseProductPage({ content: [], totalPages: -1 }).totalPages).toBe(
      0,
    );
    expect(
      parseProductPage({ content: [], totalPages: 'x' }).totalPages,
    ).toBe(0);
  });
});

describe('pickMatches', () => {
  const variants = [
    { id: 'v1', sku: 'ABC', barcode: '111' },
    { id: 'v2', sku: 'dup', barcode: null },
    { id: 'v3', sku: 'DUP', barcode: null },
    { id: 'v4', sku: 'only', barcode: null },
  ];

  it('prefers barcode, then unique SKU case-insensitively', () => {
    const m = pickMatches(
      [
        item('111', 'only'),
        item('222', 'ONLY'),
        item('333', 'dup'),
        item('444'),
      ],
      variants,
    );
    expect(m.get('111')).toBe('v1');
    expect(m.get('222')).toBe('v4');
    expect(m.has('333')).toBe(false); // ambiguous SKU never guessed
    expect(m.has('444')).toBe(false);
  });
});

describe('parsePullPayload / productHash', () => {
  it('accepts only an empty object', () => {
    expect(parsePullPayload({})).toEqual({});
    expect(() => parsePullPayload({ a: 1 })).toThrow(SyncError);
    expect(() => parsePullPayload([])).toThrow(SyncError);
  });

  it('hash is stable and content-sensitive', () => {
    expect(productHash(item('1'))).toBe(productHash(item('1')));
    expect(productHash(item('1'))).not.toBe(productHash(item('1', 'x')));
    expect(productHash(item('1'))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('TrendyolProductsSync.run', () => {
  function setup(pages: ReturnType<typeof item>[][], liveCallsAllowed = true) {
    const adapter = {
      listProducts: vi.fn((_c: unknown, page: number) =>
        Promise.resolve({ items: pages[page] ?? [], totalPages: pages.length }),
      ),
    };
    const products = {
      matchVariantsForChannel: vi.fn(() =>
        Promise.resolve([{ id: 'v1', sku: 'A', barcode: '111' }]),
      ),
    };
    const linked: [string, string][] = [];
    const takeRate = vi.fn(() => Promise.resolve());
    const ctx = {
      tenantId: 't',
      companyId: 'c',
      channelAccountId: 'a',
      channel: 'trendyol',
      syncJobId: 'j',
      attempt: 1,
      credentials: {},
      liveCallsAllowed,
      stats: emptyStats(),
      takeRate,
      claim: vi.fn((i: { externalId: string }) =>
        Promise.resolve({
          decision: 'created' as const,
          refId: `ref-${i.externalId}`,
          localId: null,
          needsImport: true,
        }),
      ),
      linkLocal: vi.fn((r: string, l: string) => {
        linked.push([r, l]);
        return Promise.resolve();
      }),
    } as unknown as SyncContext;
    const svc = new TrendyolProductsSync(
      { registerKind: vi.fn() } as never,
      products as never,
      adapter as never,
    );
    return { svc, ctx, adapter, linked, takeRate };
  }

  it('pages through, links matches, counts unmatched as skipped', async () => {
    const { svc, ctx, adapter, linked, takeRate } = setup([
      [item('111'), item('999')],
      [item('888')],
    ]);
    await svc.run(ctx);
    expect(adapter.listProducts).toHaveBeenCalledTimes(2);
    expect(takeRate).toHaveBeenCalledTimes(2);
    expect(linked).toEqual([['ref-111', 'v1']]);
    expect(ctx.stats.skipped).toBe(2);
  });

  it('refuses to call Trendyol when live calls are off', async () => {
    const { svc, ctx, adapter } = setup([[item('111')]], false);
    await expect(svc.run(ctx)).rejects.toMatchObject({
      code: 'SYNC_LIVE_CALLS_DISABLED',
    });
    expect(adapter.listProducts).not.toHaveBeenCalled();
  });
});
