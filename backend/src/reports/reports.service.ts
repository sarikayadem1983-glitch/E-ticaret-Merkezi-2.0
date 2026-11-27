import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AccessService } from '../access/access.service.js';
import type { AuthUser } from '../auth/decorators.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { buildStockReport, SALE_REASONS } from './stock-report.js';
import {
  buildSalesReport,
  EXCLUDED_STATUSES,
  type GroupBy,
} from './sales-report.js';

export const READ = 'orders:read';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
/** Upper bound of orders in one report; larger ranges must be narrowed. */
export const MAX_ORDERS = 20000;

export class SalesReportQuery {
  @Matches(DAY, { message: 'Tarih YYYY-AA-GG biçiminde olmalı' })
  from: string;

  @Matches(DAY, { message: 'Tarih YYYY-AA-GG biçiminde olmalı' })
  to: string;

  @IsOptional()
  @IsIn(['day', 'channel', 'product'])
  group_by: GroupBy = 'day';

  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(50)
  channel?: string;
}

export const STOCK_READ = 'inventory:read';
/** Costs are private: only members who may edit products see them (as in the cost API). */
export const COST_READ = 'products:write';
/** Upper bound of variants in one stock report; larger catalogs must filter by company. */
export const MAX_VARIANTS = 20000;

export class StockReportQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  days: number = 30;

  @IsOptional()
  @IsUUID()
  company_id?: string;
}

/** Start of a calendar day in Europe/Istanbul (UTC+3, no DST since 2016). */
const istanbulStart = (day: string) => new Date(`${day}T00:00:00+03:00`);

/**
 * Sales reports (RPT-01): orders of the companies the member may read, in a date range
 * of Istanbul calendar days. Cancelled and unsupplied orders are not sales; returned
 * orders are counted separately. Amounts are exact decimals per currency.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly access: AccessService,
  ) {}

  async sales(user: AuthUser, q: SalesReportQuery) {
    const from = istanbulStart(q.from);
    const toExclusive = istanbulStart(q.to);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    if (Number.isNaN(from.getTime()) || Number.isNaN(toExclusive.getTime())) {
      throw this.invalid('from', 'Geçersiz tarih');
    }
    const days = (toExclusive.getTime() - from.getTime()) / 86_400_000;
    if (days < 1)
      throw this.invalid('to', 'Bitiş tarihi başlangıçtan önce olamaz');
    if (days > MAX_DAYS)
      throw this.invalid('to', `En çok ${MAX_DAYS} günlük rapor alınabilir`);

    const scope = await this.access.companyScope(user, READ);
    let companyIds: string[] | undefined;
    if (scope === null) companyIds = q.company_id ? [q.company_id] : undefined;
    else
      companyIds = q.company_id
        ? scope.filter((id) => id === q.company_id)
        : scope;

    const orders = await this.prisma.order.findMany({
      where: {
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        ...(q.channel ? { channel: q.channel } : {}),
        orderedAt: { gte: from, lt: toExclusive },
        status: { notIn: [...EXCLUDED_STATUSES] },
      },
      select: {
        id: true,
        channel: true,
        status: true,
        currency: true,
        total: true,
        orderedAt: true,
      },
      orderBy: { orderedAt: 'asc' },
      take: MAX_ORDERS + 1,
    });
    if (orders.length > MAX_ORDERS) {
      throw new UnprocessableEntityException({
        code: 'REPORT_TOO_LARGE',
        message: `Dönemde ${MAX_ORDERS}'den fazla sipariş var; aralığı daraltın`,
      });
    }
    const lines = [];
    for (let i = 0; i < orders.length; i += 1000) {
      lines.push(
        ...(await this.prisma.orderItem.findMany({
          where: {
            orderId: { in: orders.slice(i, i + 1000).map((o) => o.id) },
          },
          select: {
            orderId: true,
            sku: true,
            name: true,
            quantity: true,
            lineTotal: true,
          },
        })),
      );
    }
    const report = buildSalesReport(orders, lines, q.group_by);
    return {
      data: report.rows,
      meta: {
        from: q.from,
        to: q.to,
        groupBy: q.group_by,
        totals: report.totals,
        excludedStatuses: EXCLUDED_STATUSES,
      },
    };
  }

  /**
   * Stock report (RPT-02): value at current purchase cost, turnover and out-of-stock
   * per variant of the companies the member may read stock of. Sales are the net
   * order movements of the last `days` days. Cost and value only for companies where
   * the member may edit products; otherwise they are null.
   */
  async stock(user: AuthUser, q: StockReportQuery) {
    const [scope, costScope] = await Promise.all([
      this.access.companyScope(user, STOCK_READ),
      this.access.companyScope(user, COST_READ),
    ]);
    let companyIds: string[] | undefined;
    if (scope === null) companyIds = q.company_id ? [q.company_id] : undefined;
    else
      companyIds = q.company_id
        ? scope.filter((id) => id === q.company_id)
        : scope;
    const inCompanies = companyIds ? { companyId: { in: companyIds } } : {};

    const variants = await this.prisma.productVariant.findMany({
      where: { ...inCompanies, deletedAt: null, product: { deletedAt: null } },
      select: {
        id: true,
        companyId: true,
        sku: true,
        purchaseCost: true,
        costCurrency: true,
        product: { select: { name: true } },
      },
      orderBy: { sku: 'asc' },
      take: MAX_VARIANTS + 1,
    });
    if (variants.length > MAX_VARIANTS) {
      throw new UnprocessableEntityException({
        code: 'REPORT_TOO_LARGE',
        message: `${MAX_VARIANTS}'den fazla varyant var; firma seçin`,
      });
    }
    const since = new Date(Date.now() - q.days * 86_400_000);
    const [levels, movements] = await Promise.all([
      this.prisma.stockLevel.groupBy({
        by: ['variantId'],
        where: inCompanies,
        _sum: { onHand: true, reserved: true },
      }),
      this.prisma.stockMovement.groupBy({
        by: ['variantId', 'reason'],
        where: {
          ...inCompanies,
          reason: { in: [...SALE_REASONS] },
          createdAt: { gte: since },
        },
        _sum: { quantity: true },
      }),
    ]);
    const costCompanies = costScope === null ? null : new Set(costScope);
    const report = buildStockReport(
      variants.map((v) => ({
        id: v.id,
        companyId: v.companyId,
        sku: v.sku,
        name: v.product.name,
        purchaseCost: v.purchaseCost,
        costCurrency: v.costCurrency,
      })),
      levels.map((l) => ({
        variantId: l.variantId,
        onHand: l._sum.onHand ?? 0,
        reserved: l._sum.reserved ?? 0,
      })),
      movements.map((m) => ({
        variantId: m.variantId,
        reason: m.reason,
        quantity: m._sum.quantity ?? 0,
      })),
      q.days,
      (companyId) => costCompanies === null || costCompanies.has(companyId),
    );
    return {
      data: report.rows,
      meta: { days: q.days, totals: report.totals },
    };
  }

  private invalid(field: string, message: string) {
    return new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message,
      errors: [{ field, message }],
    });
  }
}
