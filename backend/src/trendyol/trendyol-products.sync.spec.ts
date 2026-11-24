import { describe, expect, it, vi } from 'vitest';
import { parseProductPage } from '../channels/trendyol.adapter.js';
import { SyncError } from '../sync/sync-errors.js';
import { emptyStats, type SyncContext } from '../sync/sync.types.js';
import {
  TrendyolProductsSync,
  parseImportPayload,
  parsePullPayload,
  pickMatches,
  planNewProducts,
  productHash,
} from './trendyol-products.sync.js';

const item = (barcode: string, stockCode: string | null = null) => ({
  barcode,
  stockCode,
  title: 'T',
  productMainId: null,
  approved: true,
  lastUpdateDate: null,
  vatRate: null as number | null,
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
        vatRate: null,
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
    expect(parseProductPage({ content: [], totalPages: 'x' }).totalPages).toBe(
      0,
    );
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

describe('planNewProducts', () => {
  const t = (
    barcode: string,
    stockCode: string | null,
    main: string | null,
    vat: number | null = 20,
  ) => ({ ...item(barcode, stockCode), productMainId: main, vatRate: vat });

  it('groups by productMainId, falls back to barcode SKU, maps VAT', () => {
    const r = planNewProducts(
      [t('1', 'A-S', 'M1'), t('2', 'A-M', 'M1'), t('3', null, null, 18)],
      { skus: new Set(), barcodes: new Set() },
    );
    expect(r.skipped).toBe(0);
    expect(r.products).toEqual([
      {
        name: 'T',
        vatRate: '20',
        variants: [
          { sku: 'A-S', barcode: '1' },
          { sku: 'A-M', barcode: '2' },
        ],
      },
      { name: 'T', vatRate: null, variants: [{ sku: '3', barcode: '3' }] },
    ]);
  });

  it('leaves out taken and repeated identifiers', () => {
    const r = planNewProducts(
      [
        t('1', 'X', null),
        t('2', 'taken', null),
        t('3', 'x', null),
        t('9', 'Y', null),
      ],
      { skus: new Set(['taken']), barcodes: new Set(['9']) },
    );
    expect(r.skipped).toBe(3);
    expect(r.products.map((p) => p.variants)).toEqual([
      [{ sku: 'X', barcode: '1' }],
    ]);
  });
});

describe('parseImportPayload', () => {
  it('needs exactly a uuid actor', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseImportPayload({ actorUserId: id })).toEqual({
      actorUserId: id,
    });
    expect(() => parseImportPayload({})).toThrow(SyncError);
    expect(() => parseImportPayload({ actorUserId: 'x' })).toThrow(SyncError);
    expect(() => parseImportPayload({ actorUserId: id, extra: 1 })).toThrow(
      SyncError,
    );
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
      takenIdentifiers: vi.fn(() =>
        Promise.resolve({
          skus: new Set<string>(),
          barcodes: new Set<string>(),
        }),
      ),
      createFromChannel: vi.fn(
        (_c: string, p: { variants: { barcode: string }[] }) =>
          Promise.resolve({
            id: 'p',
            variants: p.variants.map((v) => ({
              id: `new-${v.barcode}`,
              barcode: v.barcode,
            })),
          }),
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
    return { svc, ctx, adapter, linked, takeRate, products };
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

  it('import mode creates draft products for unmatched items and links them', async () => {
    const { svc, ctx, linked, products } = setup([
      [item('111'), item('999', 'S9')],
    ]);
    await svc.run(ctx, '11111111-1111-4111-8111-111111111111');
    expect(products.createFromChannel).toHaveBeenCalledTimes(1);
    expect(products.createFromChannel.mock.calls[0][1]).toEqual({
      name: 'T',
      vatRate: null,
      variants: [{ sku: 'S9', barcode: '999' }],
    });
    expect(linked).toEqual([
      ['ref-111', 'v1'],
      ['ref-999', 'new-999'],
    ]);
    expect(ctx.stats.skipped).toBe(0);
    expect(ctx.stats.updated).toBe(1);
  });

  it('refuses to call Trendyol when live calls are off', async () => {
    const { svc, ctx, adapter } = setup([[item('111')]], false);
    await expect(svc.run(ctx)).rejects.toMatchObject({
      code: 'SYNC_LIVE_CALLS_DISABLED',
    });
    expect(adapter.listProducts).not.toHaveBeenCalled();
  });
});
