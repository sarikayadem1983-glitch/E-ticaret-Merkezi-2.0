import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../catalog/products.service.js';
import {
  TrendyolAdapter,
  type TrendyolProduct,
} from '../channels/trendyol.adapter.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { SyncError } from '../sync/sync-errors.js';
import { SyncService } from '../sync/sync.service.js';
import type { SyncContext } from '../sync/sync.types.js';
import {
  MAX_PAGES,
  PAGE_SIZE,
  parseImportPayload,
  productHash,
  TRENDYOL_ADAPTER,
  type ImportPayload,
} from './trendyol-products.sync.js';

export const TRENDYOL_STOCK_PRICE_PULL = 'trendyol.stock-price.pull';
/** Price channel code used for Trendyol sale prices (CHANNEL_PATTERN). */
export const TRENDYOL_PRICE_CHANNEL = 'trendyol';

/**
 * INT-TY-02a: reads stock and sale price from Trendyol into the app (nothing
 * is written to Trendyol). Only products already linked to a local variant
 * (INT-TY-01a) are touched:
 * - price: the Trendyol sale price becomes the variant's `trendyol` channel price;
 * - stock: seeded ONCE as an opening movement when the variant has no stock
 *   history; local stock is never overwritten afterwards (`stockKept`).
 * Unlinked products, and stock when the company has no default warehouse,
 * are counted as skipped.
 */
@Injectable()
export class TrendyolStockPriceSync implements OnModuleInit {
  constructor(
    private readonly sync: SyncService,
    private readonly products: ProductsService,
    private readonly inventory: InventoryService,
    @Inject(TRENDYOL_ADAPTER) private readonly adapter: TrendyolAdapter,
  ) {}

  onModuleInit(): void {
    this.sync.registerKind<ImportPayload>(
      TRENDYOL_STOCK_PRICE_PULL,
      (payload, ctx) => this.run(ctx, payload.actorUserId),
      { parse: parseImportPayload, usesLiveApi: true, attempts: 3 },
    );
  }

  async run(ctx: SyncContext, actorUserId: string): Promise<void> {
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
      for (const item of res.items) {
        await this.apply(item, ctx, actorUserId);
      }
      page += 1;
    }
  }

  private async apply(
    item: TrendyolProduct,
    ctx: SyncContext,
    actorUserId: string,
  ): Promise<void> {
    const claim = await ctx.claim({
      entityType: 'variant',
      externalId: item.barcode,
      externalUpdatedAt: item.lastUpdateDate,
      payloadHash: productHash(item),
    });
    const stats = ctx.stats;
    if (claim.localId === null) {
      stats.skipped += 1;
      return;
    }
    if (item.salePrice !== null) {
      const r = await this.products.setPriceFromChannel(
        ctx.companyId,
        claim.localId,
        TRENDYOL_PRICE_CHANNEL,
        item.salePrice,
        'TRY',
        actorUserId,
      );
      if (r === 'created' || r === 'updated') {
        stats.pricesSet = (stats.pricesSet ?? 0) + 1;
      }
    }
    if (item.quantity !== null) {
      const r = await this.inventory.openingFromChannel(
        ctx.companyId,
        claim.localId,
        item.quantity,
        ctx.syncJobId,
        actorUserId,
      );
      if (r === 'created') stats.stockSeeded = (stats.stockSeeded ?? 0) + 1;
      else if (r === 'exists') stats.stockKept = (stats.stockKept ?? 0) + 1;
      else if (r === 'no_warehouse') stats.skipped += 1;
    }
  }
}
