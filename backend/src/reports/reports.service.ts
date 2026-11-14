import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
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

  private invalid(field: string, message: string) {
    return new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message,
      errors: [{ field, message }],
    });
  }
}
