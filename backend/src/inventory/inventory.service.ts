import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { ProductsService } from '../catalog/products.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import type {
  CreateMovementDto,
  CreateWarehouseDto,
  ListByCompanyQuery,
  ListLevelsQuery,
  ListMovementsQuery,
  CountDto,
  SetThresholdDto,
  TransferDto,
} from './inventory.dto.js';
import { mapStockError } from './inventory.repository.js';

export const READ = 'inventory:read';
export const WRITE = 'inventory:write';
const MODULE = 'inventory';

const notFound = (what: string) =>
  new NotFoundException({ code: 'NOT_FOUND', message: `${what} bulunamadı` });

const WAREHOUSE_FIELDS = {
  id: true,
  companyId: true,
  name: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WarehouseSelect;

/**
 * Warehouses, stock levels and manual stock movements (INV-02). Access follows the
 * member's role in the company: no role → 404, no permission → 403. Stock changes only
 * through movements (database trigger); reservations go through ReservationsRepository.
 */
@Injectable()
export class InventoryService {
  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly products: ProductsService,
  ) {}

  private async assertPermission(
    user: AuthUser,
    companyId: string,
    permission: string,
    what: string,
  ) {
    try {
      await this.access.assertCompanyPermission(user, companyId, permission);
    } catch (error) {
      if (error instanceof NotFoundException) throw notFound(what);
      throw error;
    }
  }

  /** Company ids the member may read, or undefined for all (tenant-wide roles). */
  private async readableCompanies(user: AuthUser, companyId?: string) {
    const scope = await this.access.companyScope(user, READ);
    if (scope === null) return companyId ? [companyId] : undefined;
    return companyId ? scope.filter((id) => id === companyId) : scope;
  }

  async listWarehouses(user: AuthUser, q: ListByCompanyQuery) {
    const companyIds = await this.readableCompanies(user, q.company_id);
    const rows = await this.prisma.warehouse.findMany({
      where: companyIds ? { companyId: { in: companyIds } } : {},
      select: WAREHOUSE_FIELDS,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return { data: rows };
  }

  async createWarehouse(user: AuthUser, dto: CreateWarehouseDto) {
    await this.assertPermission(user, dto.companyId, WRITE, 'Firma');
    const [active] = await this.companies.activeByIds([dto.companyId]);
    if (!active) {
      if (
        (await this.companies.namesByIds([dto.companyId])).has(dto.companyId)
      ) {
        throw new ConflictException({
          code: 'COMPANY_INACTIVE',
          message: 'Firma pasif; depo eklenemez',
        });
      }
      throw notFound('Firma');
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.warehouse.create({
          data: {
            tenantId: TenantContext.requireTenantId(),
            companyId: dto.companyId,
            name: dto.name,
            isDefault: dto.isDefault ?? false,
          },
          select: WAREHOUSE_FIELDS,
        });
        await this.audit.record(
          {
            action: 'CREATE',
            module: MODULE,
            entityType: 'Warehouse',
            entityId: created.id,
            after: created,
          },
          tx,
        );
        return created;
      });
      return { data: row };
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      if (text.includes('lower_name_key')) {
        throw new ConflictException({
          code: 'WAREHOUSE_NAME_TAKEN',
          message: 'Bu firmada aynı adlı bir depo var',
        });
      }
      if (text.includes('default_key')) {
        throw new ConflictException({
          code: 'WAREHOUSE_DEFAULT_TAKEN',
          message: 'Firmanın zaten bir varsayılan deposu var',
        });
      }
      throw error;
    }
  }

  async listLevels(user: AuthUser, q: ListLevelsQuery) {
    const companyIds = await this.readableCompanies(user, q.company_id);
    const where: Prisma.StockLevelWhereInput = {
      ...(companyIds ? { companyId: { in: companyIds } } : {}),
      ...(q.warehouse_id ? { warehouseId: q.warehouse_id } : {}),
      ...(q.variant_id ? { variantId: q.variant_id } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockLevel.findMany({
        where,
        select: {
          id: true,
          companyId: true,
          warehouseId: true,
          variantId: true,
          onHand: true,
          reserved: true,
          updatedAt: true,
          warehouse: { select: { name: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
      this.prisma.stockLevel.count({ where }),
    ]);
    const labels = await this.products.variantLabels([
      ...new Set(rows.map((r) => r.variantId)),
    ]);
    const thresholds = await this.thresholds([
      ...new Set(rows.map((r) => r.variantId)),
    ]);
    return {
      data: rows.map(({ warehouse, ...l }) => ({
        ...l,
        available: l.onHand - l.reserved,
        sku: labels.get(l.variantId)?.sku ?? null,
        productName: labels.get(l.variantId)?.name ?? null,
        warehouseName: warehouse.name,
        threshold: thresholds.get(l.variantId) ?? null,
      })),
      meta: { page: q.page, per_page: q.per_page, total },
    };
  }

  /** Whether the company keeps stock at all (has any warehouse). */
  async usesStock(companyId: string, tx: PrismaTx): Promise<boolean> {
    return (await tx.warehouse.count({ where: { companyId } })) > 0;
  }

  /** The company's default active warehouse, for reservations without an explicit one. */
  async defaultWarehouse(
    companyId: string,
    tx: PrismaTx,
  ): Promise<string | null> {
    const row = await tx.warehouse.findFirst({
      where: { companyId, isDefault: true, isActive: true },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async createMovement(user: AuthUser, dto: CreateMovementDto) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId },
      select: { id: true, companyId: true, isActive: true },
    });
    if (!warehouse) throw notFound('Depo');
    await this.assertPermission(user, warehouse.companyId, WRITE, 'Depo');
    if (!warehouse.isActive) {
      throw new ConflictException({
        code: 'WAREHOUSE_INACTIVE',
        message: 'Depo pasif; stok hareketi yazılamaz',
      });
    }
    if (
      (dto.reason === 'opening' || dto.reason === 'purchase') &&
      dto.quantity < 0
    ) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Açılış ve satın alma hareketi pozitif olmalı',
        errors: [{ field: 'quantity', message: 'pozitif olmalı' }],
      });
    }
    try {
      const movement = await this.prisma.$transaction(async (tx) => {
        const [variant] = await this.products.variantsForOrder(
          warehouse.companyId,
          [dto.variantId],
          tx,
        );
        if (!variant) throw notFound('Varyant');
        const created = await tx.stockMovement.create({
          data: {
            tenantId: TenantContext.requireTenantId(),
            companyId: warehouse.companyId,
            warehouseId: warehouse.id,
            variantId: dto.variantId,
            quantity: dto.quantity,
            reason: dto.reason,
            referenceType: 'manual',
            createdBy: user.sub,
          },
        });
        await this.audit.record(
          {
            action: 'CREATE',
            module: MODULE,
            entityType: 'StockMovement',
            entityId: created.id,
            after: {
              warehouseId: created.warehouseId,
              variantId: created.variantId,
              quantity: created.quantity,
              reason: created.reason,
            },
          },
          tx,
        );
        return created;
      });
      return { data: movement };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      mapStockError(error);
    }
  }

  async listMovements(user: AuthUser, q: ListMovementsQuery) {
    const companyIds = await this.readableCompanies(user);
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        ...(companyIds ? { companyId: { in: companyIds } } : {}),
        ...(q.warehouse_id ? { warehouseId: q.warehouse_id } : {}),
        ...(q.variant_id ? { variantId: q.variant_id } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
    });
    return { data: rows };
  }

  /** Sets (or with null removes) the low-stock threshold of a variant (INV-03). */
  async setThreshold(user: AuthUser, variantId: string, dto: SetThresholdDto) {
    const variant = (await this.products.variantLabels([variantId])).get(
      variantId,
    );
    if (!variant) throw notFound('Varyant');
    await this.assertPermission(user, variant.companyId, WRITE, 'Varyant');
    const threshold = dto.threshold ?? null;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.stockThreshold.findFirst({
        where: { variantId },
        select: { threshold: true },
      });
      if (threshold === null) {
        await tx.stockThreshold.deleteMany({ where: { variantId } });
      } else if (before) {
        await tx.stockThreshold.updateMany({
          where: { variantId },
          data: { threshold },
        });
      } else {
        await tx.stockThreshold.create({
          data: {
            tenantId: TenantContext.requireTenantId(),
            companyId: variant.companyId,
            variantId,
            threshold,
          },
        });
      }
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: 'StockThreshold',
          entityId: variantId,
          before: { threshold: before?.threshold ?? null },
          after: { threshold },
        },
        tx,
      );
    });
    return { data: { variantId, threshold } };
  }

  /**
   * Variants at or below their threshold (INV-03): available = on_hand - reserved summed
   * over all warehouses of the company; a variant without stock rows counts as 0.
   */
  async lowStock(user: AuthUser, q: ListByCompanyQuery) {
    const companyIds = await this.readableCompanies(user, q.company_id);
    const thresholds = await this.prisma.stockThreshold.findMany({
      where: companyIds ? { companyId: { in: companyIds } } : {},
      select: { variantId: true, companyId: true, threshold: true },
    });
    if (thresholds.length === 0) return { data: [] };
    const ids = thresholds.map((t) => t.variantId);
    const sums = await this.prisma.stockLevel.groupBy({
      by: ['variantId'],
      where: { variantId: { in: ids } },
      _sum: { onHand: true, reserved: true },
    });
    const available = new Map(
      sums.map((s) => [
        s.variantId,
        (s._sum.onHand ?? 0) - (s._sum.reserved ?? 0),
      ]),
    );
    const labels = await this.products.variantLabels(ids);
    const data = thresholds
      .map((t) => ({
        variantId: t.variantId,
        companyId: t.companyId,
        sku: labels.get(t.variantId)?.sku ?? null,
        productName: labels.get(t.variantId)?.name ?? null,
        threshold: t.threshold,
        available: available.get(t.variantId) ?? 0,
      }))
      .filter((r) => r.available <= r.threshold)
      .sort(
        (a, b) =>
          a.available - a.threshold - (b.available - b.threshold) ||
          a.available - b.available ||
          (a.sku ?? '').localeCompare(b.sku ?? ''),
      );
    return { data };
  }

  /** Thresholds of the given variants (for the stock list). */
  async thresholds(variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.prisma.stockThreshold.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, threshold: true },
    });
    return new Map(rows.map((r) => [r.variantId, r.threshold]));
  }

  /** Active warehouse of the tenant, or 404/409; checks the write permission on its company. */
  private async writableWarehouse(user: AuthUser, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id },
      select: { id: true, companyId: true, isActive: true },
    });
    if (!warehouse) throw notFound('Depo');
    await this.assertPermission(user, warehouse.companyId, WRITE, 'Depo');
    if (!warehouse.isActive) {
      throw new ConflictException({
        code: 'WAREHOUSE_INACTIVE',
        message: 'Depo pasif; stok hareketi yazılamaz',
      });
    }
    return warehouse;
  }

  /**
   * INV-04 transfer: transfer_out from the source and transfer_in to the target in one
   * transaction, both referencing the same transfer id. Not enough stock (reserved units
   * included) → 409, nothing written.
   */
  async transfer(user: AuthUser, dto: TransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Kaynak ve hedef depo aynı olamaz',
      });
    }
    const from = await this.writableWarehouse(user, dto.fromWarehouseId);
    const to = await this.writableWarehouse(user, dto.toWarehouseId);
    if (from.companyId !== to.companyId) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message:
          'Transfer yalnızca aynı firmanın depoları arasında yapılabilir',
      });
    }
    const transferId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        const [variant] = await this.products.variantsForOrder(
          from.companyId,
          [dto.variantId],
          tx,
        );
        if (!variant) throw notFound('Varyant');
        const base = {
          tenantId: TenantContext.requireTenantId(),
          companyId: from.companyId,
          variantId: dto.variantId,
          referenceType: 'transfer',
          referenceId: transferId,
          createdBy: user.sub,
        };
        await tx.stockMovement.create({
          data: {
            ...base,
            warehouseId: from.id,
            quantity: -dto.quantity,
            reason: 'transfer_out',
          },
        });
        await tx.stockMovement.create({
          data: {
            ...base,
            warehouseId: to.id,
            quantity: dto.quantity,
            reason: 'transfer_in',
          },
        });
        await this.audit.record(
          {
            action: 'CREATE',
            module: MODULE,
            entityType: 'StockTransfer',
            entityId: transferId,
            after: {
              from: from.id,
              to: to.id,
              variantId: dto.variantId,
              quantity: dto.quantity,
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      mapStockError(error);
    }
    return { data: { transferId, quantity: dto.quantity } };
  }

  /**
   * INV-04 count: writes the difference between the counted and the current on_hand as one
   * 'count' movement (none when equal). SERIALIZABLE: a sale between reading on_hand and
   * writing the difference aborts one transaction (409, retry). Counting below reserved → 409.
   */
  async count(user: AuthUser, dto: CountDto) {
    const warehouse = await this.writableWarehouse(user, dto.warehouseId);
    try {
      const diff = await this.prisma.$transaction(
        async (tx) => {
          const [variant] = await this.products.variantsForOrder(
            warehouse.companyId,
            [dto.variantId],
            tx,
          );
          if (!variant) throw notFound('Varyant');
          const level = await tx.stockLevel.findFirst({
            where: { warehouseId: warehouse.id, variantId: dto.variantId },
            select: { onHand: true },
          });
          const delta = dto.counted - (level?.onHand ?? 0);
          if (delta !== 0) {
            await tx.stockMovement.create({
              data: {
                tenantId: TenantContext.requireTenantId(),
                companyId: warehouse.companyId,
                warehouseId: warehouse.id,
                variantId: dto.variantId,
                quantity: delta,
                reason: 'count',
                referenceType: 'manual',
                createdBy: user.sub,
              },
            });
          }
          return delta;
        },
        { isolationLevel: 'Serializable' },
      );
      return { data: { counted: dto.counted, difference: diff } };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      mapStockError(error);
    }
  }
}
