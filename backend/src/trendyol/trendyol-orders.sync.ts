import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  TrendyolAdapter,
  type TrendyolPackage,
} from '../channels/trendyol.adapter.js';
import { OrdersService } from '../orders/orders.service.js';
import { ExternalRefsRepository } from '../sync/external-refs.repository.js';
import { SyncError } from '../sync/sync-errors.js';
import { SyncService } from '../sync/sync.service.js';
import type { SyncContext } from '../sync/sync.types.js';
import { MAX_PAGES, TRENDYOL_ADAPTER } from './trendyol-products.sync.js';

export const TRENDYOL_ORDERS_PULL = 'trendyol.orders.pull';
/** Trendyol accepts at most 2 weeks per order query. */
export const MAX_DAYS = 14;
const PAGE = 50;
const DAY_MS = 86_400_000;

export interface OrdersPullPayload {
  /** How many days back (by package last-modified date), 1–14. */
  days: number;
}

export function parseOrdersPayload(raw: unknown): OrdersPullPayload {
  const r = raw as { days?: unknown } | null;
  if (
    !r ||
    typeof r !== 'object' ||
    Object.keys(r).length !== 1 ||
    typeof r.days !== 'number' ||
    !Number.isInteger(r.days) ||
    r.days < 1 ||
    r.days > MAX_DAYS
  ) {
    throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
  }
  return { days: r.days };
}

/** Stable hash of what we store: a change in any of it is an update. */
export function packageHash(p: TrendyolPackage): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        p.status,
        p.total,
        p.lines.map((l) => [l.externalLineId, l.quantity, l.lineTotal]),
      ]),
    )
    .digest('hex');
}

/**
 * INT-TY-03a: reads Trendyol shipment packages (read-only towards Trendyol) and
 * imports them as local orders, one order per package (`orderNumber/packageId`).
 * Re-runs are idempotent (external refs); a newer status moves the local order
 * through the ORD-02 table, which also releases or consumes stock. A status the
 * table refuses is counted (`statusRefused`) and retried on the next run.
 */
@Injectable()
export class TrendyolOrdersSync implements OnModuleInit {
  constructor(
    private readonly sync: SyncService,
    private readonly orders: OrdersService,
    private readonly refs: ExternalRefsRepository,
    @Inject(TRENDYOL_ADAPTER) private readonly adapter: TrendyolAdapter,
  ) {}

  onModuleInit(): void {
    this.sync.registerKind<OrdersPullPayload>(
      TRENDYOL_ORDERS_PULL,
      (payload, ctx) => this.run(ctx, payload.days),
      { parse: parseOrdersPayload, usesLiveApi: true, attempts: 3 },
    );
  }

  async run(ctx: SyncContext, days: number, now = new Date()): Promise<void> {
    if (ctx.channel !== 'trendyol') {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    if (!ctx.liveCallsAllowed) {
      throw new SyncError('SYNC_LIVE_CALLS_DISABLED', 'permanent');
    }
    const start = new Date(now.getTime() - days * DAY_MS);
    let page = 0;
    let totalPages = 1;
    while (page < totalPages && page < MAX_PAGES) {
      await ctx.takeRate();
      const res = await this.adapter.listShipmentPackages(
        ctx.credentials,
        start,
        now,
        page,
        PAGE,
      );
      totalPages = res.totalPages;
      ctx.stats.skipped += res.invalid;
      const barcodes = [
        ...new Set(
          res.items.flatMap((p) =>
            p.lines.flatMap((l) => (l.barcode ? [l.barcode] : [])),
          ),
        ),
      ];
      const variantIdsByBarcode = await this.refs.localIdsByExternal(
        ctx.channelAccountId,
        'variant',
        barcodes,
      );
      for (const pkg of res.items) {
        await this.apply(pkg, ctx, variantIdsByBarcode);
      }
      page += 1;
    }
  }

  private async apply(
    pkg: TrendyolPackage,
    ctx: SyncContext,
    variantIdsByBarcode: Map<string, string>,
  ): Promise<void> {
    const r = await this.orders.applyChannelPackage(
      {
        companyId: ctx.companyId,
        channel: 'trendyol',
        channelAccountId: ctx.channelAccountId,
        externalOrderNo: `${pkg.orderNumber}/${pkg.packageId}`,
        status: pkg.status,
        currency: pkg.currency,
        subtotal: pkg.subtotal,
        discountTotal: pkg.discountTotal,
        channelDiscountTotal: pkg.channelDiscountTotal,
        total: pkg.total,
        orderedAt: pkg.orderedAt,
        lines: pkg.lines,
      },
      {
        claim: (tx) =>
          ctx.claim(
            {
              entityType: 'order',
              externalId: pkg.packageId,
              externalUpdatedAt: pkg.lastModifiedAt,
              payloadHash: packageHash(pkg),
            },
            tx,
          ),
        link: (refId, localId, tx) => ctx.linkLocal(refId, localId, tx),
        variantIdsByBarcode,
        syncJobId: ctx.syncJobId,
      },
    );
    const s = ctx.stats;
    if (r === 'status_changed') s.statusChanged = (s.statusChanged ?? 0) + 1;
    else if (r === 'status_refused') {
      // The claim was rolled back with the transaction: undo its counters too.
      s.processed -= 1;
      s.updated -= 1;
      s.statusRefused = (s.statusRefused ?? 0) + 1;
    } else if (r === 'created_unreserved') {
      s.unreserved = (s.unreserved ?? 0) + 1;
    }
    const unmatched = pkg.lines.filter(
      (l) => !l.barcode || !variantIdsByBarcode.has(l.barcode),
    ).length;
    if (r === 'created' || r === 'created_unreserved') {
      s.linesUnmatched = (s.linesUnmatched ?? 0) + unmatched;
    }
  }
}
