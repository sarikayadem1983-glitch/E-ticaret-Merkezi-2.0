import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../catalog/products.service.js';
import {
  TrendyolAdapter,
  type TrendyolStockPriceItem,
} from '../channels/trendyol.adapter.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ExternalRefsRepository } from '../sync/external-refs.repository.js';
import { SyncError } from '../sync/sync-errors.js';
import { SyncService } from '../sync/sync.service.js';
import type { SyncContext } from '../sync/sync.types.js';
import { TRENDYOL_ADAPTER, UUID_RE } from './trendyol-products.sync.js';
import { TRENDYOL_PRICE_CHANNEL } from './trendyol-stock-price.sync.js';

export const TRENDYOL_STOCK_PRICE_PUSH = 'trendyol.stock-price.push';
/** Variants per push request (one product's variants, or a small selection). */
export const MAX_PUSH_VARIANTS = 50;
/** Batch result polls after the write; Trendyol usually finishes in seconds. */
const BATCH_POLLS = 6;
const BATCH_POLL_MS = 5_000;

export interface PushPayload {
  actorUserId: string;
  variantIds: string[];
}

export function parsePushPayload(raw: unknown): PushPayload {
  const r = raw as { actorUserId?: unknown; variantIds?: unknown } | null;
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).length !== 2 ||
    typeof r.actorUserId !== 'string' ||
    !UUID_RE.test(r.actorUserId) ||
    !Array.isArray(r.variantIds) ||
    r.variantIds.length === 0 ||
    r.variantIds.length > MAX_PUSH_VARIANTS ||
    !r.variantIds.every((v) => typeof v === 'string' && UUID_RE.test(v)) ||
    new Set(r.variantIds).size !== r.variantIds.length
  ) {
    throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
  }
  return { actorUserId: r.actorUserId, variantIds: r.variantIds as string[] };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cents = (s: string) => Math.round(Number(s) * 100);

/**
 * INT-TY-02b: WRITES the local stock and Trendyol price of the selected
 * variants to Trendyol (manual, user-started; no automatic push yet).
 * - Only variants linked to a Trendyol barcode (INT-TY-01a) are sent; others
 *   are skipped.
 * - quantity = sellable local stock (on hand − reserved, all warehouses).
 *   A company without warehouses keeps no stock: nothing is sent.
 * - salePrice = the variant's local `trendyol` price, else Trendyol's current
 *   sale price (stock-only update). listPrice = Trendyol's current list price,
 *   raised to salePrice when lower (Trendyol rejects listPrice < salePrice).
 * - The current Trendyol values are read right before the write; a barcode
 *   Trendyol does not know is skipped.
 * Values are absolute, so a retry re-sends the same state. Outcome per item
 * comes from the batch result; marketplace failure texts are never stored.
 */
@Injectable()
export class TrendyolStockPricePush implements OnModuleInit {
  constructor(
    private readonly sync: SyncService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    private readonly refs: ExternalRefsRepository,
    @Inject(TRENDYOL_ADAPTER) private readonly adapter: TrendyolAdapter,
  ) {}

  onModuleInit(): void {
    this.sync.registerKind<PushPayload>(
      TRENDYOL_STOCK_PRICE_PUSH,
      (payload, ctx) => this.run(ctx, payload.variantIds),
      { parse: parsePushPayload, usesLiveApi: true, attempts: 2 },
    );
  }

  async run(ctx: SyncContext, variantIds: string[]): Promise<void> {
    if (ctx.channel !== 'trendyol') {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    if (!ctx.liveCallsAllowed) {
      throw new SyncError('SYNC_LIVE_CALLS_DISABLED', 'permanent');
    }
    const stats = ctx.stats;
    const available = await this.inventory.availableTotals(
      ctx.companyId,
      variantIds,
    );
    if (available === null) {
      throw new SyncError('STOCK_NOT_TRACKED', 'permanent');
    }
    const barcodes = await this.refs.externalIdsByLocal(
      ctx.channelAccountId,
      'variant',
      variantIds,
    );
    const prices = await this.products.channelPrices(
      ctx.companyId,
      variantIds,
      TRENDYOL_PRICE_CHANNEL,
    );

    const items: TrendyolStockPriceItem[] = [];
    for (const variantId of variantIds) {
      stats.processed += 1;
      const barcode = barcodes.get(variantId);
      if (!barcode) {
        stats.skipped += 1;
        continue;
      }
      await ctx.takeRate();
      const current = await this.adapter.findByBarcode(
        ctx.credentials,
        barcode,
      );
      const sale = prices.get(variantId) ?? current?.salePrice ?? null;
      if (!current || sale === null) {
        stats.skipped += 1;
        continue;
      }
      const saleCents = cents(sale);
      const listCents = Math.max(
        current.listPrice !== null ? cents(current.listPrice) : 0,
        saleCents,
      );
      items.push({
        barcode,
        quantity: available.get(variantId) ?? 0,
        salePrice: saleCents / 100,
        listPrice: listCents / 100,
      });
    }
    if (items.length === 0) return;

    await ctx.takeRate();
    const batchId = await this.adapter.updatePriceAndInventory(
      ctx.credentials,
      items,
    );
    stats.pushSent = items.length;

    for (let i = 0; i < BATCH_POLLS; i += 1) {
      await sleep(BATCH_POLL_MS);
      await ctx.takeRate();
      const result = await this.adapter.getBatchResult(
        ctx.credentials,
        batchId,
      );
      if (!result.completed) continue;
      const sent = new Set(items.map((it) => it.barcode));
      const mine = result.items.filter((r) => sent.has(r.barcode));
      stats.pushSucceeded = mine.filter((r) => r.status === 'SUCCESS').length;
      stats.pushFailed = mine.filter((r) => r.status === 'FAILED').length;
      return;
    }
    // Written but not confirmed in time: the job succeeds, counts stay unknown.
    stats.pushPending = items.length;
  }
}
