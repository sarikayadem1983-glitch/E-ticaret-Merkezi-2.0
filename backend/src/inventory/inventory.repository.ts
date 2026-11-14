import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/** Custom SQLSTATEs raised by the stock_* SQL functions (migration 20261114170000). */
const BY_SQLSTATE: Record<string, () => Error> = {
  TS001: () =>
    new ConflictException({
      code: 'STOCK_INSUFFICIENT',
      message: 'Depoda yeterli kullanılabilir stok yok',
    }),
  TS002: () =>
    new ConflictException({
      code: 'STOCK_ALREADY_RESERVED',
      message: 'Bu sipariş kalemi bu depoda farklı bir adetle zaten ayrılmış',
    }),
  TS003: () =>
    new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Sipariş kalemi bulunamadı veya bir ürüne bağlı değil',
    }),
  TS004: () =>
    new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Depo bulunamadı, pasif veya siparişin firmasına ait değil',
    }),
  TS005: () =>
    new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message: 'Geçersiz rezervasyon isteği',
    }),
  // Deadlock / serialization failure: nothing was written; the client may retry.
  '40P01': () =>
    new ConflictException({
      code: 'CONCURRENT_UPDATE',
      message: 'Stok aynı anda başka bir işlemle değişti; yeniden deneyin',
    }),
  '40001': () =>
    new ConflictException({
      code: 'CONCURRENT_UPDATE',
      message: 'Stok aynı anda başka bir işlemle değişti; yeniden deneyin',
    }),
};

/** Constraint names (exact) of INV-01/02 that callers may hit through movements. */
const BY_CONSTRAINT: Record<string, () => Error> = {
  stock_levels_reserved_within_on_hand: () =>
    new ConflictException({
      code: 'STOCK_RESERVED',
      message:
        'Ayrılmış stok bu hareketle düşülemez; önce rezervasyonu kaldırın',
    }),
  stock_levels_on_hand_non_negative: BY_SQLSTATE.TS001,
};

/** 5-character SQLSTATE, not a Prisma error code such as P2010. */
const isSqlState = (c: string) =>
  /^[0-9A-Z]{5}$/.test(c) && !/^P\d{4}$/.test(c);

/** SQLSTATE of a database error, wherever the Prisma driver adapter put it. */
function sqlState(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let e: unknown = error;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const o = e as Record<string, unknown>;
    const meta = o.meta as Record<string, unknown> | undefined;
    for (const c of [
      meta?.code,
      o.code,
      (meta?.driverAdapterError as Record<string, unknown> | undefined)?.cause,
    ]) {
      if (typeof c === 'string' && isSqlState(c)) return c;
      if (c && typeof c === 'object') {
        const inner =
          (c as Record<string, unknown>).originalCode ??
          (c as Record<string, unknown>).code;
        if (typeof inner === 'string' && isSqlState(inner)) return inner;
      }
    }
    e = o.cause;
  }
  // Last resort: the adapter's message names the code as `TSnnn` / `40P01` (exact token).
  const text = error instanceof Error ? error.message : '';
  return /\b(TS00[1-6]|40P01|40001)\b/.exec(text)?.[1];
}

export function mapStockError(error: unknown): never {
  if (error instanceof ConflictException || error instanceof NotFoundException)
    throw error;
  const state = sqlState(error);
  if (state === 'TS006') throw error; // tenant mismatch is a programming error: 500, never hidden
  if (state && BY_SQLSTATE[state]) throw BY_SQLSTATE[state]();
  const text = error instanceof Error ? error.message : '';
  for (const [name, make] of Object.entries(BY_CONSTRAINT)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) throw make();
  }
  throw error;
}

/**
 * Reservations (INV-02). The SQL functions are SECURITY DEFINER and filter every row by
 * the tenant id passed here; they also require app.tenant_id, set in the same transaction,
 * to be that id. Raw SQL is only allowed in system context, so this file is on the
 * runAsSystem allowlist. Always called inside the caller's transaction.
 */
@Injectable()
export class ReservationsRepository {
  private async call<T>(
    tx: PrismaTx,
    run: (tenantId: string) => Promise<T>,
  ): Promise<T> {
    const tenantId = TenantContext.requireTenantId();
    try {
      return await TenantContext.runAsSystem(async () => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return run(tenantId);
      });
    } catch (error) {
      mapStockError(error);
    }
  }

  reserve(
    tx: PrismaTx,
    orderItemId: string,
    warehouseId: string,
    quantity: number,
  ) {
    return this.call(
      tx,
      (t) =>
        tx.$queryRaw`SELECT stock_reserve(${t}::uuid, ${orderItemId}::uuid, ${warehouseId}::uuid, ${quantity}::integer)`,
    );
  }

  async release(tx: PrismaTx, orderItemId: string): Promise<number> {
    const rows = await this.call(
      tx,
      (t) =>
        tx.$queryRaw<
          { n: number }[]
        >`SELECT stock_release(${t}::uuid, ${orderItemId}::uuid) AS n`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async consume(
    tx: PrismaTx,
    orderItemId: string,
    userId: string | null,
  ): Promise<number> {
    const rows = await this.call(
      tx,
      (t) =>
        tx.$queryRaw<
          { n: number }[]
        >`SELECT stock_consume(${t}::uuid, ${orderItemId}::uuid, ${userId}::uuid) AS n`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Order lines (of the given ones) that have an active or consumed reservation. */
  async coveredLines(
    tx: PrismaTx,
    orderItemIds: string[],
  ): Promise<Set<string>> {
    if (orderItemIds.length === 0) return new Set();
    const rows = await tx.stockReservation.findMany({
      where: {
        orderItemId: { in: orderItemIds },
        status: { in: ['active', 'consumed'] },
      },
      select: { orderItemId: true },
    });
    return new Set(rows.map((r) => r.orderItemId));
  }
}
