import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../catalog/products.service.js';
import {
  TrendyolAdapter,
  type TrendyolProduct,
} from '../channels/trendyol.adapter.js';
import { SyncError } from '../sync/sync-errors.js';
import { SyncService } from '../sync/sync.service.js';
import type { SyncContext } from '../sync/sync.types.js';

export const TRENDYOL_PRODUCTS_PULL = 'trendyol.products.pull';
export const TRENDYOL_ADAPTER = Symbol('TRENDYOL_ADAPTER');

/** Trendyol's documented maximum page size for the product list. */
export const PAGE_SIZE = 200;
/** Safety bound: 500 pages × 200 = 100k products per run. */
export const MAX_PAGES = 500;

export type PullPayload = Record<string, never>;

export function parsePullPayload(raw: unknown): PullPayload {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).length > 0
  ) {
    throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
  }
  return {};
}

/** Stable hash of the fields we keep, so an unchanged product is "unchanged". */
export function productHash(p: TrendyolProduct): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        p.barcode,
        p.stockCode,
        p.title,
        p.productMainId,
        p.approved,
        p.lastUpdateDate?.getTime() ?? null,
      ]),
    )
    .digest('hex');
}

/**
 * Picks the local variant for each Trendyol product: barcode (exact) first,
 * then stock code = SKU (case-insensitive) when exactly one variant has it.
 * Never guesses: an ambiguous SKU stays unmatched.
 */
export function pickMatches(
  items: readonly TrendyolProduct[],
  variants: readonly { id: string; sku: string; barcode: string | null }[],
): Map<string, string> {
  const byBarcode = new Map<string, string>();
  const bySku = new Map<string, string | null>();
  for (const v of variants) {
    if (v.barcode) byBarcode.set(v.barcode, v.id);
    const k = v.sku.toLowerCase();
    bySku.set(k, bySku.has(k) ? null : v.id);
  }
  const out = new Map<string, string>();
  for (const it of items) {
    const id =
      byBarcode.get(it.barcode) ??
      (it.stockCode ? bySku.get(it.stockCode.toLowerCase()) : undefined);
    if (id) out.set(it.barcode, id);
  }
  return out;
}

/**
 * INT-TY-01a: pulls the seller's Trendyol products (read-only) and links each
 * one to a local variant via channel_external_refs. Nothing is written to
 * Trendyol. Unmatched products keep a ref without a local id and are counted
 * as `skipped`.
 */
@Injectable()
export class TrendyolProductsSync implements OnModuleInit {
  constructor(
    private readonly sync: SyncService,
    private readonly products: ProductsService,
    @Inject(TRENDYOL_ADAPTER) private readonly adapter: TrendyolAdapter,
  ) {}

  onModuleInit(): void {
    this.sync.registerKind<PullPayload>(
      TRENDYOL_PRODUCTS_PULL,
      (_payload, ctx) => this.run(ctx),
      { parse: parsePullPayload, usesLiveApi: true, attempts: 3 },
    );
  }

  async run(ctx: SyncContext): Promise<void> {
    if (ctx.channel !== 'trendyol') {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    if (!ctx.liveCallsAllowed) {
      throw new SyncError('SYNC_LIVE_CALLS_DISABLED', 'permanent');
    }
    let page = 0;
    let totalPages = 1;
    while (page < totalPages && page < MAX_PAGES) {
      await ctx.takeRate();
      const res = await this.adapter.listProducts(
        ctx.credentials,
        page,
        PAGE_SIZE,
      );
      totalPages = res.totalPages;
      await this.processPage(res.items, ctx);
      page += 1;
    }
  }

  private async processPage(
    items: readonly TrendyolProduct[],
    ctx: SyncContext,
  ): Promise<void> {
    if (items.length === 0) return;
    const variants = await this.products.matchVariantsForChannel(
      ctx.companyId,
      [...new Set(items.map((i) => i.barcode))],
      [...new Set(items.flatMap((i) => (i.stockCode ? [i.stockCode] : [])))],
    );
    const matches = pickMatches(items, variants);
    for (const item of items) {
      const claim = await ctx.claim({
        entityType: 'variant',
        externalId: item.barcode,
        externalUpdatedAt: item.lastUpdateDate,
        payloadHash: productHash(item),
      });
      const localId = matches.get(item.barcode);
      if (claim.localId === null && localId) {
        await ctx.linkLocal(claim.refId, localId);
      } else if (claim.localId === null) {
        ctx.stats.skipped += 1;
      }
    }
  }
}
