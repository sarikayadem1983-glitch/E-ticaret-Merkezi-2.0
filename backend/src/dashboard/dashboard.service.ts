import { Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import type { AuthUser } from '../auth/decorators.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { istanbulDay } from '../reports/sales-report.js';
import { SyncService } from '../sync/sync.service.js';

/** Orders not shipped yet and not finished: they still need work (DSH-02). */
export const PENDING_SHIPMENT = [
  'awaiting',
  'created',
  'picking',
  'invoiced',
  'unpacked',
  'repack',
] as const;

/**
 * Dashboard KPIs (DSH-02). Every number reuses the module that owns it so the cards
 * always equal the reports: today's sales come from ReportsService (same exclusions,
 * same Istanbul day), low stock from InventoryService, integration errors from
 * SyncService. Each is filtered by the member's company roles; a KPI the member may
 * not see is null, never a partial number.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly access: AccessService,
    private readonly reports: ReportsService,
    private readonly inventory: InventoryService,
    private readonly sync: SyncService,
  ) {}

  private async can(user: AuthUser, permission: string) {
    // null scope = tenant-wide role; [] = no company grants the permission.
    const scope = await this.access.companyScope(user, permission);
    return { allowed: scope === null || scope.length > 0, scope };
  }

  async kpis(user: AuthUser, companyId?: string) {
    const today = istanbulDay(new Date());
    const orders = await this.can(user, 'orders:read');
    const stock = await this.can(user, 'inventory:read');

    let todaySales:
      | {
          currency: string;
          orders: number;
          revenue: string;
          returned: number;
        }[]
      | null = null;
    let pendingShipment: number | null = null;
    if (orders.allowed) {
      const report = await this.reports.sales(user, {
        from: today,
        to: today,
        group_by: 'day',
        company_id: companyId,
      });
      todaySales = report.meta.totals;
      const ids =
        orders.scope === null
          ? companyId
            ? [companyId]
            : undefined
          : orders.scope.filter((id) => !companyId || id === companyId);
      pendingShipment = await this.prisma.order.count({
        where: {
          ...(ids ? { companyId: { in: ids } } : {}),
          status: { in: [...PENDING_SHIPMENT] },
        },
      });
    }
    const lowStock = stock.allowed
      ? (await this.inventory.lowStock(user, { company_id: companyId })).data
          .length
      : null;
    const since = new Date(Date.now() - 7 * 86_400_000);
    // Integrations are visible only to members who manage channels (INT-03).
    const integrationErrors = (await this.access.hasTenantPermission(
      user.sub,
      'channels:manage',
    ))
      ? await this.sync.failedCount(since, companyId)
      : null;

    return {
      data: {
        day: today,
        todaySales,
        pendingShipment,
        lowStock,
        integrationErrors,
      },
    };
  }
}
