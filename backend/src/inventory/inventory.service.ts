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
    return {
      data: rows.map(({ warehouse, ...l }) => ({
        ...l,
        available: l.onHand - l.reserved,
        sku: labels.get(l.variantId)?.sku ?? null,
        productName: labels.get(l.variantId)?.name ?? null,
        warehouseName: warehouse.name,
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
}
