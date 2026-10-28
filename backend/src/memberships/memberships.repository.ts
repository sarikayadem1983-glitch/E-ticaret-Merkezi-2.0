import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export interface ActiveMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
}

export interface LoginMembership extends ActiveMembership {
  active: boolean;
  tenantActive: boolean;
  /** Last status change, used to pick the most recent membership. */
  changedAt: Date;
}

/**
 * Data access for tenant_memberships. Tenant-scoped by the Prisma extension,
 * except findActiveForUser, which lists a user's stores across tenants.
 */
@Injectable()
export class MembershipsRepository {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  /**
   * System context: the user's active memberships in active tenants, ordered by
   * tenant name (login's default when last_tenant_id is not usable).
   */
  async findActiveForUser(userId: string): Promise<ActiveMembership[]> {
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.tenantMembership.findMany({
        where: {
          userId,
          status: 'active',
          tenant: { isActive: true, deletedAt: null },
        },
        select: { tenant: { select: { id: true, name: true, slug: true } } },
        orderBy: [{ tenant: { name: 'asc' } }, { tenantId: 'asc' }],
      }),
    );
    return rows.map(({ tenant }) => ({
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    }));
  }

  /**
   * System context: every membership of the user with its tenant's state, in one
   * query. Login derives the usable stores from it and, when none is usable,
   * the tenant to record the failed attempt in.
   */
  async findAllForUser(userId: string): Promise<LoginMembership[]> {
    const rows = await TenantContext.runAsSystem(() =>
      this.prisma.tenantMembership.findMany({
        where: { userId },
        select: {
          status: true,
          updatedAt: true,
          deactivatedAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              deletedAt: true,
            },
          },
        },
        orderBy: [{ tenant: { name: 'asc' } }, { tenantId: 'asc' }],
      }),
    );
    return rows.map((r) => ({
      tenantId: r.tenant.id,
      tenantName: r.tenant.name,
      tenantSlug: r.tenant.slug,
      active: r.status === 'active',
      tenantActive: r.tenant.isActive && r.tenant.deletedAt === null,
      changedAt: r.deactivatedAt ?? r.updatedAt,
    }));
  }

  /** Tenant context: the membership with the member's public profile, or null. */
  get(tenantId: string, userId: string, db: PrismaTx = this.prisma) {
    return db.tenantMembership.findFirst({
      where: { tenantId, userId },
      select: {
        status: true,
        authVersion: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /** Tenant context: adds the user to the current tenant as an active member. */
  create(db: PrismaTx, userId: string) {
    return db.tenantMembership.create({
      data: { userId, tenantId: TenantContext.requireTenantId() },
      select: { authVersion: true },
    });
  }
}
