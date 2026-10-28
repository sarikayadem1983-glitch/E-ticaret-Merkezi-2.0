import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { AuditAction, Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export interface AuditRow {
  actorUserId: string | null;
  action: AuditAction;
  module: string;
  entityType: string;
  entityId: string | null;
  before: Prisma.InputJsonValue | undefined;
  after: Prisma.InputJsonValue | undefined;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditFilter {
  action?: AuditAction;
  module?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: Date;
  to?: Date;
}

const PUBLIC_FIELDS = {
  id: true,
  action: true,
  module: true,
  entityType: true,
  entityId: true,
  actorUserId: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

/** Append and read only. There is deliberately no update or delete method. */
@Injectable()
export class AuditRepository {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  insert(row: AuditRow, db: PrismaTx = this.prisma) {
    return db.auditLog.create({
      data: { ...row, tenantId: TenantContext.requireTenantId() },
      select: { id: true },
    });
  }

  async findPage(filter: AuditFilter, page: number, perPage: number) {
    const where: Prisma.AuditLogWhereInput = {
      action: filter.action,
      module: filter.module,
      entityType: filter.entityType,
      entityId: filter.entityId,
      actorUserId: filter.actorUserId,
      createdAt:
        filter.from || filter.to
          ? { gte: filter.from, lte: filter.to }
          : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: PUBLIC_FIELDS,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }

  findById(id: string) {
    return this.prisma.auditLog.findFirst({
      where: { id },
      select: PUBLIC_FIELDS,
    });
  }
}
