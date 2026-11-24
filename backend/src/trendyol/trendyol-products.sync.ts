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
/** Pull + match, then create draft local products for what is still unmatched. */
export const TRENDYOL_PRODUCTS_IMPORT = 'trendyol.products.import';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAT_RATES = new Set(['0', '1', '10', '20']);

export interface ImportPayload {
  /** User who started it; recorded as the audit actor of created products. */
  actorUserId: string;
}

export function parseImportPayload(raw: unknown): ImportPayload {
  const r = raw as { actorUserId?: unknown } | null;
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).length !== 1 ||
    typeof r.actorUserId !== 'string' ||
    !UUID_RE.test(r.actorUserId)
  ) {
    throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
  }
  return { actorUserId: r.actorUserId };
}

export interface NewProduct {
  name: string;
  vatRate: string | null;
  variants: { sku: string; barcode: string }[];
}

/**
 * Groups unmatched Trendyol items into draft products: one product per
 * productMainId (else per barcode). SKU = stock code, or the barcode when
 * there is none. Items whose SKU or barcode is already taken locally (also by
 * deleted variants), or repeats inside the batch, are left out; a group that
 * loses all items is dropped. Returns the products and how many items were left out.
 */
export function planNewProducts(
  items: readonly TrendyolProduct[],
  taken: { skus: Set<string>; barcodes: Set<string> },
): { products: NewProduct[]; skipped: number } {
  const groups = new Map<string, NewProduct>();
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  let skipped = 0;
  for (const it of items) {
    const sku = (it.stockCode ?? it.barcode).slice(0, 100);
    const key = sku.toLowerCase();
    if (
      taken.skus.has(key) ||
      taken.barcodes.has(it.barcode) ||
      seenSku.has(key) ||
      seenBarcode.has(it.barcode)
    ) {
      skipped += 1;
      continue;
    }
    seenSku.add(key);
    seenBarcode.add(it.barcode);
    const groupKey = it.productMainId ?? `barcode:${it.barcode}`;
    let g = groups.get(groupKey);
    if (!g) {
      const vat = it.vatRate === null ? null : String(it.vatRate);
      g = {
        name: (it.title ?? sku).slice(0, 250),
        vatRate: vat !== null && VAT_RATES.has(vat) ? vat : null,
        variants: [],
      };
      groups.set(groupKey, g);
    }
    g.variants.push({ sku, barcode: it.barcode });
  }
  return { products: [...groups.values()], skipped };
}
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
    this.sync.registerKind<ImportPayload>(
      TRENDYOL_PRODUCTS_IMPORT,
      (payload, ctx) => this.run(ctx, payload.actorUserId),
      { parse: parseImportPayload, usesLiveApi: true, attempts: 3 },
    );
  }

  /** `createFor` set → unmatched items become draft local products (audit actor). */
  async run(ctx: SyncContext, createFor?: string): Promise<void> {
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
      const unmatched = await this.processPage(res.items, ctx);
      if (createFor !== undefined && unmatched.length > 0) {
        await this.createMissing(unmatched, ctx, createFor);
      }
      page += 1;
    }
  }

  /**
   * Creates draft products for unmatched items and links their refs. Each
   * product is its own transaction; a crash between create and link leaves a
   * product whose barcode the next run matches (no duplicate).
   */
  private async createMissing(
    unmatched: readonly { item: TrendyolProduct; refId: string }[],
    ctx: SyncContext,
    actorUserId: string,
  ): Promise<void> {
    const items = unmatched.map((u) => u.item);
    const taken = await this.products.takenIdentifiers(
      items.map((i) => (i.stockCode ?? i.barcode).slice(0, 100)),
      items.map((i) => i.barcode),
    );
    const plan = planNewProducts(items, taken);
    const refByBarcode = new Map(
      unmatched.map((u) => [u.item.barcode, u.refId]),
    );
    for (const p of plan.products) {
      const created = await this.products.createFromChannel(
        ctx.companyId,
        p,
        actorUserId,
      );
      for (const v of created.variants) {
        const refId = v.barcode ? refByBarcode.get(v.barcode) : undefined;
        if (refId) {
          await ctx.linkLocal(refId, v.id);
          ctx.stats.skipped -= 1;
          ctx.stats.updated += 1;
        }
      }
    }
  }

  /** Links matches; returns the items still without a local variant. */
  private async processPage(
    items: readonly TrendyolProduct[],
    ctx: SyncContext,
  ): Promise<{ item: TrendyolProduct; refId: string }[]> {
    const unmatched: { item: TrendyolProduct; refId: string }[] = [];
    if (items.length === 0) return unmatched;
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
        unmatched.push({ item, refId: claim.refId });
      }
    }
    return unmatched;
  }
}
