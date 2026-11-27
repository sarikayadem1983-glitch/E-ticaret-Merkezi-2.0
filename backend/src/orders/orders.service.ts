import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { money } from '../catalog/pricing.js';
import { ProductsService } from '../catalog/products.service.js';
import { ReservationsRepository } from '../inventory/inventory.repository.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CompaniesService } from '../companies/companies.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { canTransition, type OrderStatus } from './order-status.js';
import type {
  ChangeStatusDto,
  CreateOrderDto,
  ListOrdersQuery,
} from './orders.dto.js';

export const READ = 'orders:read';
export const WRITE = 'orders:write';
const MODULE = 'orders';
const ENTITY = 'Order';
export const MANUAL_CHANNEL = 'manual';
/** Statuses before shipping: stock can still be reserved. */
const RESERVABLE = new Set<OrderStatus>([
  'awaiting',
  'created',
  'picking',
  'invoiced',
  'unpacked',
  'repack',
]);

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'Sipariş bulunamadı' });

const ORDER_FIELDS = {
  id: true,
  companyId: true,
  channel: true,
  channelAccountId: true,
  externalOrderNo: true,
  status: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  channelDiscountTotal: true,
  shippingTotal: true,
  total: true,
  orderedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_FIELDS }>;

const DETAIL_FIELDS = {
  ...ORDER_FIELDS,
  items: {
    select: {
      id: true,
      variantId: true,
      externalLineId: true,
      sku: true,
      name: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      vatRate: true,
      lineTotal: true,
    },
    // Lines of one order share created_at: SKU makes the order stable.
    orderBy: [{ createdAt: 'asc' }, { sku: 'asc' }],
  },
  statusHistory: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      source: true,
      changedBy: true,
      changedAt: true,
    },
    orderBy: { changedAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

type DetailRow = Prisma.OrderGetPayload<{ select: typeof DETAIL_FIELDS }>;

/** API shape: amounts as fixed 2-digit strings, never JSON numbers. */
const view = (o: OrderRow) => ({
  ...o,
  subtotal: money(o.subtotal),
  discountTotal: money(o.discountTotal),
  channelDiscountTotal: money(o.channelDiscountTotal),
  shippingTotal: money(o.shippingTotal),
  total: money(o.total),
});

const detail = (o: DetailRow) => ({
  ...view(o),
  items: o.items.map((i) => ({
    ...i,
    unitPrice: money(i.unitPrice),
    discount: money(i.discount),
    vatRate: i.vatRate === null ? null : money(i.vatRate),
    lineTotal: money(i.lineTotal),
  })),
  statusHistory: o.statusHistory,
});

const D = (v: string | Prisma.Decimal) => new Prisma.Decimal(v);
const MAX_AMOUNT = D('9999999999.99');

/**
 * Orders (ORD-02). Access follows the member's role in the order's company, read
 * from the database: no role → 404, a role without the permission → 403. Status
 * changes follow the table in order-status.ts; marketplace orders change status
 * only through their channel (INT-TY-03), never by hand here.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly products: ProductsService,
    private readonly reservations: ReservationsRepository,
    private readonly inventory: InventoryService,
  ) {}

  async list(user: AuthUser, q: ListOrdersQuery) {
    const scope = await this.access.companyScope(user, READ);
    let companyIds: string[] | undefined;
    if (scope === null) {
      companyIds = q.company_id ? [q.company_id] : undefined;
    } else {
      companyIds = q.company_id
        ? scope.filter((id) => id === q.company_id)
        : scope;
    }
    const where: Prisma.OrderWhereInput = {
      ...(companyIds ? { companyId: { in: companyIds } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.search ? { externalOrderNo: { startsWith: q.search } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        select: ORDER_FIELDS,
        orderBy: [{ orderedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.per_page,
        take: q.per_page,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: rows.map(view),
      meta: { page: q.page, per_page: q.per_page, total },
    };
  }

  /** The member's role in the company; a missing company role reads as a missing order. */
  private async assertPermission(
    user: AuthUser,
    companyId: string,
    permission: string,
  ) {
    try {
      await this.access.assertCompanyPermission(user, companyId, permission);
    } catch (error) {
      if (error instanceof NotFoundException) throw notFound();
      throw error;
    }
  }

  async get(user: AuthUser, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id },
      select: DETAIL_FIELDS,
    });
    if (!order) throw notFound();
    await this.assertPermission(user, order.companyId, READ);
    return { data: detail(order) };
  }

  /** Manual order: items are snapshots of the company's own active variants. */
  async create(user: AuthUser, dto: CreateOrderDto) {
    await this.assertPermission(user, dto.companyId, WRITE);
    // Tenant-wide roles pass the role check for any id: an unknown company is still 404.
    if (
      !(await this.companies.namesByIds([dto.companyId])).has(dto.companyId)
    ) {
      throw notFound();
    }
    const variantIds = [...new Set(dto.items.map((i) => i.variantId))];
    if (variantIds.length !== dto.items.length) {
      throw new UnprocessableEntityException({
        code: 'ORDER_ITEM_DUPLICATE',
        message: 'Aynı varyant siparişte iki kez yer alıyor; adedi artırın',
      });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const [active] = await this.companies.activeByIds([dto.companyId], tx);
      if (!active) {
        throw new ConflictException({
          code: 'COMPANY_INACTIVE',
          message: 'Firma pasif; sipariş oluşturulamaz',
        });
      }
      const variants = await this.products.variantsForOrder(
        dto.companyId,
        variantIds,
        tx,
      );
      const byId = new Map(variants.map((v) => [v.id, v]));
      const missing = variantIds.filter((v) => !byId.has(v));
      if (missing.length) {
        throw new UnprocessableEntityException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Varyant bulunamadı veya bu firmaya ait değil',
          errors: missing.map((v) => ({ field: 'items', message: v })),
        });
      }
      const lines = dto.items.map((i, index) => {
        const v = byId.get(i.variantId)!;
        const gross = D(i.unitPrice).times(i.quantity);
        const discount = D(i.discount ?? '0');
        if (discount.greaterThan(gross)) {
          throw new UnprocessableEntityException({
            code: 'VALIDATION_ERROR',
            message: 'Satır indirimi satır tutarını aşıyor',
            errors: [
              { field: `items.${index}.discount`, message: 'çok büyük' },
            ],
          });
        }
        return {
          variantId: v.id,
          sku: v.sku,
          name: v.name,
          quantity: i.quantity,
          unitPrice: D(i.unitPrice),
          discount,
          vatRate: v.vatRate,
          lineTotal: gross.minus(discount),
        };
      });
      const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), D('0'));
      const discountTotal = D(dto.discountTotal ?? '0');
      const shippingTotal = D(dto.shippingTotal ?? '0');
      const total = subtotal.minus(discountTotal).plus(shippingTotal);
      if (total.isNegative()) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_ERROR',
          message: 'Sipariş indirimi tutarı aşıyor',
          errors: [{ field: 'discountTotal', message: 'çok büyük' }],
        });
      }
      if (subtotal.greaterThan(MAX_AMOUNT) || total.greaterThan(MAX_AMOUNT)) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_ERROR',
          message: 'Sipariş tutarı çok büyük',
        });
      }
      const order = await tx.order.create({
        data: {
          tenantId: TenantContext.requireTenantId(),
          companyId: dto.companyId,
          channel: MANUAL_CHANNEL,
          status: 'created',
          currency: dto.currency,
          subtotal,
          discountTotal,
          shippingTotal,
          total,
          orderedAt: dto.orderedAt ? new Date(dto.orderedAt) : new Date(),
          items: {
            // tenant_id, company_id and order_id come from the parent order (composite FK).
            create: lines,
          },
          statusHistory: {
            create: {
              toStatus: 'created',
              source: 'user',
              changedBy: user.sub,
            },
          },
        },
        select: { id: true },
      });
      const created = await tx.order.findFirstOrThrow({
        where: { id: order.id },
        select: DETAIL_FIELDS,
      });
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: order.id,
          after: detail(created),
        },
        tx,
      );
      return order.id;
    });
    return this.get(user, id);
  }

  /**
   * Reserves stock for every matched line (INV-02) in one warehouse (default: the company's
   * default warehouse). All lines or none: any shortage rolls the whole request back.
   * Local stock only: nothing is sent to a marketplace.
   */
  async reserve(user: AuthUser, id: string, warehouseId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id },
        select: ORDER_FIELDS,
      });
      if (!order) throw notFound();
      await this.assertPermission(user, order.companyId, 'inventory:write');
      // Locks the order row and proves its status is still the one read: a concurrent
      // ship/cancel either waits for us or has already changed the status (→ 409 here).
      await this.lockStatus(tx, order);
      if (!RESERVABLE.has(order.status as OrderStatus)) {
        throw new ConflictException({
          code: 'ORDER_NOT_RESERVABLE',
          message: 'Bu durumdaki siparişe stok ayrılamaz',
        });
      }
      const target =
        warehouseId ??
        (await this.inventory.defaultWarehouse(order.companyId, tx));
      if (!target) {
        throw new ConflictException({
          code: 'WAREHOUSE_REQUIRED',
          message: 'Firmanın varsayılan deposu yok; depo seçin',
        });
      }
      const items = await this.matchedLines(tx, order.id);
      for (const item of items) {
        await this.reservations.reserve(tx, item.id, target, item.quantity);
      }
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: order.id,
          after: { reservedInWarehouse: target, lines: items.length },
        },
        tx,
      );
    });
    return this.get(user, id);
  }

  /** Row lock on the order, only if its status is still `order.status`. */
  private async lockStatus(
    tx: PrismaTx,
    order: Pick<OrderRow, 'id' | 'status'>,
  ) {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { updatedAt: new Date() },
    });
    if (count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: 'Sipariş başka bir işlemle değişti; yeniden deneyin',
      });
    }
  }

  /**
   * Lines linked to a variant, in variant order: every transaction locks stock rows in the
   * same order, so two multi-line orders cannot deadlock on each other.
   */
  private matchedLines(tx: PrismaTx, orderId: string) {
    return tx.orderItem.findMany({
      where: { orderId, variantId: { not: null } },
      select: { id: true, quantity: true, variantId: true },
      orderBy: [{ variantId: 'asc' }, { id: 'asc' }],
    });
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangeStatusDto) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id },
        select: ORDER_FIELDS,
      });
      if (!order) throw notFound();
      await this.assertPermission(user, order.companyId, WRITE);
      if (order.channel !== MANUAL_CHANNEL) {
        throw new ConflictException({
          code: 'CHANNEL_MANAGED',
          message:
            'Pazaryeri siparişinin durumu pazaryerinden gelir; buradan değiştirilemez',
        });
      }
      await this.transition(tx, order, dto.status, {
        source: 'user',
        changedBy: user.sub,
      });
    });
    return this.get(user, id);
  }

  /**
   * The only way a status changes: checks the table, updates only if the status is
   * still the one we read (concurrent change → 409), writes history and audit.
   * INT-TY-03 calls this with source 'channel' inside its own transaction.
   */
  async transition(
    tx: PrismaTx,
    order: Pick<OrderRow, 'id' | 'status' | 'companyId'>,
    to: OrderStatus,
    by: {
      source: 'user' | 'channel' | 'system';
      changedBy?: string;
      syncJobId?: string;
    },
  ) {
    const from = order.status as OrderStatus;
    if (!canTransition(from, to)) {
      throw new ConflictException({
        code: 'ORDER_TRANSITION_INVALID',
        message: `Sipariş durumu ${from} → ${to} olarak değiştirilemez`,
      });
    }
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: from },
      data: { status: to },
    });
    if (count !== 1) {
      throw new ConflictException({
        code: 'CONCURRENT_UPDATE',
        message: 'Sipariş başka bir işlemle değişti; yeniden deneyin',
      });
    }
    // Stock follows the status (INV-02). Shipping lowers stock for every matched line: lines
    // without a reservation are reserved first in the default warehouse, so an order never
    // ships without its stock (shortage → 409, nothing changes). Cancelling releases.
    // Returns ('returned') do not restock automatically: goods are inspected first and put
    // back with a 'return' movement (SHP-01 / INT-TY-03).
    if (to === 'shipped' || to === 'cancelled' || to === 'unsupplied') {
      const items = await this.matchedLines(tx, order.id);
      if (to === 'shipped') {
        const covered = await this.reservations.coveredLines(
          tx,
          items.map((i) => i.id),
        );
        const missing = items.filter((i) => !covered.has(i.id));
        // A company without any warehouse does not keep stock: shipping does not touch it.
        if (
          missing.length > 0 &&
          (await this.inventory.usesStock(order.companyId, tx))
        ) {
          const target = await this.inventory.defaultWarehouse(
            order.companyId,
            tx,
          );
          if (!target) {
            throw new ConflictException({
              code: 'WAREHOUSE_REQUIRED',
              message:
                'Stok ayrılmamış ve firmanın varsayılan deposu yok; önce stok ayırın',
            });
          }
          for (const item of missing) {
            await this.reservations.reserve(tx, item.id, target, item.quantity);
          }
        }
        for (const item of items) {
          await this.reservations.consume(tx, item.id, by.changedBy ?? null);
        }
      } else {
        for (const item of items) await this.reservations.release(tx, item.id);
      }
    }
    await tx.orderStatusHistory.create({
      data: {
        tenantId: TenantContext.requireTenantId(),
        orderId: order.id,
        fromStatus: from,
        toStatus: to,
        source: by.source,
        changedBy: by.changedBy ?? null,
        syncJobId: by.syncJobId ?? null,
      },
    });
    await this.audit.record(
      {
        action: 'UPDATE',
        module: MODULE,
        entityType: ENTITY,
        entityId: order.id,
        before: { status: from },
        after: { status: to },
      },
      tx,
    );
  }

  /**
   * INT-TY-03: imports or updates one marketplace package as a local order. `claim` and
   * `link` are the sync engine's external-ref calls; they run in the SAME transaction, so a
   * failed import or a refused status change leaves the ref untouched and the next run
   * retries it. Lines are matched to variants by `variantIdsByBarcode` (the channel's
   * variant refs). Status changes go through `transition` (stock follows the status).
   *
   * Stock: an order first seen BEFORE shipping is reserved in the default warehouse
   * afterwards, in its own transaction (a shortage only leaves it unreserved). An order
   * first seen already shipped or later does not touch stock: the channel's stock read
   * (INT-TY-02a) already reflects it.
   */
  async applyChannelPackage(
    pkg: ChannelPackage,
    deps: {
      claim: (tx: PrismaTx) => Promise<{
        decision: string;
        refId: string;
        localId: string | null;
        needsImport: boolean;
      }>;
      link: (refId: string, localId: string, tx: PrismaTx) => Promise<void>;
      variantIdsByBarcode: Map<string, string>;
      syncJobId: string;
    },
  ): Promise<ChannelApplyResult> {
    let reserveId: string | null = null;
    let result: ChannelApplyResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const claim = await deps.claim(tx);
        if (claim.needsImport) {
          const id = await this.createChannelOrder(tx, pkg, deps);
          await deps.link(claim.refId, id, tx);
          if (RESERVABLE.has(pkg.status)) reserveId = id;
          return 'created';
        }
        if (claim.decision !== 'updated' || claim.localId === null) {
          return 'unchanged';
        }
        const order = await tx.order.findFirst({
          where: { id: claim.localId },
          select: { id: true, status: true, companyId: true },
        });
        if (!order) return 'unchanged';
        if (order.status === pkg.status) return 'updated';
        if (!canTransition(order.status as OrderStatus, pkg.status)) {
          throw new ChannelTransitionRefused('invalid');
        }
        try {
          await this.transition(tx, order, pkg.status, {
            source: 'channel',
            syncJobId: deps.syncJobId,
          });
        } catch (error) {
          if (error instanceof ConflictException) {
            throw new ChannelTransitionRefused('conflict');
          }
          throw error;
        }
        return 'status_changed';
      });
    } catch (error) {
      if (error instanceof ChannelTransitionRefused) return 'status_refused';
      throw error;
    }
    if (reserveId) {
      const ok = await this.reserveForChannel(reserveId);
      if (!ok) return 'created_unreserved';
    }
    return result;
  }

  /** Reserves matched lines in the default warehouse; false when it could not (no warehouse, shortage). */
  private async reserveForChannel(orderId: string): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findFirst({
          where: { id: orderId },
          select: { id: true, status: true, companyId: true },
        });
        if (!order || !RESERVABLE.has(order.status as OrderStatus)) {
          return true;
        }
        if (!(await this.inventory.usesStock(order.companyId, tx))) return true;
        const target = await this.inventory.defaultWarehouse(
          order.companyId,
          tx,
        );
        if (!target) return false;
        await this.lockStatus(tx, order);
        const items = await this.matchedLines(tx, order.id);
        const covered = await this.reservations.coveredLines(
          tx,
          items.map((i) => i.id),
        );
        for (const item of items) {
          if (covered.has(item.id)) continue;
          await this.reservations.reserve(tx, item.id, target, item.quantity);
        }
        return true;
      });
    } catch (error) {
      if (error instanceof HttpException) return false;
      throw error;
    }
  }

  private async createChannelOrder(
    tx: PrismaTx,
    pkg: ChannelPackage,
    deps: { variantIdsByBarcode: Map<string, string>; syncJobId: string },
  ): Promise<string> {
    const order = await tx.order.create({
      data: {
        tenantId: TenantContext.requireTenantId(),
        companyId: pkg.companyId,
        channel: pkg.channel,
        channelAccountId: pkg.channelAccountId,
        externalOrderNo: pkg.externalOrderNo,
        status: pkg.status,
        currency: pkg.currency,
        subtotal: D(pkg.subtotal),
        discountTotal: D(pkg.discountTotal),
        channelDiscountTotal: D(pkg.channelDiscountTotal),
        shippingTotal: D('0'),
        total: D(pkg.total),
        orderedAt: pkg.orderedAt,
        items: {
          create: pkg.lines.map((l) => ({
            variantId: l.barcode
              ? (deps.variantIdsByBarcode.get(l.barcode) ?? null)
              : null,
            externalLineId: l.externalLineId,
            sku: l.sku,
            name: l.name,
            quantity: l.quantity,
            unitPrice: D(l.unitPrice),
            discount: D(l.discount),
            vatRate: l.vatRate === null ? null : D(l.vatRate),
            lineTotal: D(l.lineTotal),
          })),
        },
        statusHistory: {
          create: {
            toStatus: pkg.status,
            source: 'channel',
            syncJobId: deps.syncJobId,
          },
        },
      },
      select: { id: true },
    });
    const created = await tx.order.findFirstOrThrow({
      where: { id: order.id },
      select: DETAIL_FIELDS,
    });
    await this.audit.record(
      {
        action: 'CREATE',
        module: MODULE,
        entityType: ENTITY,
        entityId: order.id,
        after: detail(created),
      },
      tx,
    );
    return order.id;
  }
}

class ChannelTransitionRefused extends Error {
  constructor(readonly reason: 'invalid' | 'conflict') {
    super(reason);
  }
}

export type ChannelApplyResult =
  | 'created'
  | 'created_unreserved'
  | 'updated'
  | 'status_changed'
  | 'status_refused'
  | 'unchanged';

/** One marketplace package, already validated by the channel adapter. Amounts are 2-digit strings. */
export interface ChannelPackage {
  companyId: string;
  channel: string;
  channelAccountId: string;
  externalOrderNo: string;
  status: OrderStatus;
  currency: string;
  subtotal: string;
  discountTotal: string;
  channelDiscountTotal: string;
  total: string;
  orderedAt: Date;
  lines: {
    externalLineId: string;
    barcode: string | null;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: string;
    discount: string;
    vatRate: string | null;
    lineTotal: string;
  }[];
}
