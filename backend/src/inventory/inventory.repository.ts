import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/** Stable codes raised by the stock_* SQL functions (migration 20261114170000). */
const CODES = {
  STOCK_INSUFFICIENT: () =>
    new ConflictException({
      code: 'STOCK_INSUFFICIENT',
      message: 'Depoda yeterli kullanılabilir stok yok',
    }),
  STOCK_ALREADY_RESERVED: () =>
    new ConflictException({
      code: 'STOCK_ALREADY_RESERVED',
      message: 'Bu sipariş kalemi bu depoda farklı bir adetle zaten ayrılmış',
    }),
  STOCK_ORDER_ITEM_NOT_FOUND: () =>
    new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Sipariş kalemi bulunamadı veya bir ürüne bağlı değil',
    }),
  STOCK_WAREHOUSE_NOT_FOUND: () =>
    new NotFoundException({
      code: 'NOT_FOUND',
      message: 'Depo bulunamadı, pasif veya siparişin firmasına ait değil',
    }),
  STOCK_INVALID_REQUEST: () =>
    new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message: 'Geçersiz rezervasyon isteği',
    }),
} as const;

function mapStockError(error: unknown): never {
  const text = error instanceof Error ? error.message : String(error);
  for (const [code, make] of Object.entries(CODES)) {
    if (text.includes(code)) throw make();
  }
  if (text.includes('stock_levels_reserved_within_on_hand')) {
    throw new ConflictException({
      code: 'STOCK_RESERVED',
      message:
        'Ayrılmış stok bu hareketle düşülemez; önce rezervasyonu kaldırın',
    });
  }
  if (text.includes('stock_levels_on_hand_non_negative'))
    throw CODES.STOCK_INSUFFICIENT();
  throw error;
}

/**
 * Reservations (INV-02). The SQL functions are SECURITY DEFINER and filter every row by
 * the tenant id passed here; raw SQL is only allowed in system context, so this file is on
 * the runAsSystem allowlist. Always called inside the caller's transaction.
 */
@Injectable()
export class ReservationsRepository {
  async reserve(
    tx: PrismaTx,
    orderItemId: string,
    warehouseId: string,
    quantity: number,
  ) {
    const tenantId = TenantContext.requireTenantId();
    try {
      await TenantContext.runAsSystem(
        () =>
          tx.$queryRaw`SELECT stock_reserve(${tenantId}::uuid, ${orderItemId}::uuid, ${warehouseId}::uuid, ${quantity}::integer)`,
      );
    } catch (error) {
      mapStockError(error);
    }
  }

  async release(tx: PrismaTx, orderItemId: string): Promise<number> {
    const tenantId = TenantContext.requireTenantId();
    const rows = await TenantContext.runAsSystem(
      () =>
        tx.$queryRaw<
          { n: number }[]
        >`SELECT stock_release(${tenantId}::uuid, ${orderItemId}::uuid) AS n`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async consume(
    tx: PrismaTx,
    orderItemId: string,
    userId: string | null,
  ): Promise<number> {
    const tenantId = TenantContext.requireTenantId();
    try {
      const rows = await TenantContext.runAsSystem(
        () =>
          tx.$queryRaw<
            { n: number }[]
          >`SELECT stock_consume(${tenantId}::uuid, ${orderItemId}::uuid, ${userId}::uuid) AS n`,
      );
      return Number(rows[0]?.n ?? 0);
    } catch (error) {
      mapStockError(error);
    }
  }
}

export { mapStockError };
