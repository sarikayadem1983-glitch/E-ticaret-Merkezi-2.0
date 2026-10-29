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

  /**
   * Inside a transaction: the auth version of the user's membership in the
   * tenant when the membership is active and the tenant is active, else null.
   * The membership row is held with FOR SHARE until the transaction ends, so
   * a concurrent deactivation either commits first (null here) or waits.
   * Row locks need raw SQL, which the extension allows only in system
   * context; the query filters by the given tenant itself.
   */
  async lockActive(
    tx: PrismaTx,
    tenantId: string,
    userId: string,
  ): Promise<number | null> {
    const rows = await TenantContext.runAsSystem(
      () => tx.$queryRaw<{ auth_version: number }[]>`
      SELECT m.auth_version
      FROM tenant_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.user_id = ${userId}::uuid
        AND m.status = 'active' AND t.is_active AND t.deleted_at IS NULL
      FOR SHARE OF m`,
    );
    return rows[0]?.auth_version ?? null;
  }

  /**
   * Per-request session check (JwtAuthGuard): the membership's status, its
   * auth_version and whether its tenant and the global user are active (not
   * deactivated, not soft-deleted), in one primary-key lookup joined to
   * tenants and users. Null when the user has no membership in the tenant.
   * Raw SQL runs only in system context; the query filters by the given
   * tenant itself.
   */
  async sessionState(
    tenantId: string,
    userId: string,
  ): Promise<{ usable: boolean; authVersion: number } | null> {
    const rows = await TenantContext.runAsSystem(
      () => this.prisma.$queryRaw<{ usable: boolean; auth_version: number }[]>`
      SELECT (m.status = 'active' AND t.is_active AND t.deleted_at IS NULL
              AND u.is_active AND u.deleted_at IS NULL) AS usable,
             m.auth_version
      FROM tenant_memberships m
      JOIN tenants t ON t.id = m.tenant_id
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId}::uuid AND m.user_id = ${userId}::uuid`,
    );
    const row = rows[0];
    return row ? { usable: row.usable, authVersion: row.auth_version } : null;
  }

  /**
   * Tenant context, inside the caller's transaction: invalidates every access
   * token of this membership (the guard answers TOKEN_STALE or, when the
   * membership is no longer active, SESSION_REVOKED). Refresh tokens are not
   * touched; callers that end sessions revoke them separately.
   */
  async bumpAuthVersion(
    tx: PrismaTx,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const { count } = await tx.tenantMembership.updateMany({
      where: { tenantId, userId },
      data: { authVersion: { increment: 1 } },
    });
    if (count !== 1) {
      throw new Error('Üyelik bulunamadı: auth_version artırılamadı');
    }
  }

  /**
   * System context, inside the caller's transaction (refresh token reuse):
   * bumps auth_version on every membership of the user in every tenant, active
   * or not, so every access token of the user is refused on its next request.
   * The query filters by userId itself. Returns the affected tenant ids.
   */
  async bumpAuthVersionForUser(tx: PrismaTx, userId: string): Promise<string[]> {
    const rows = await TenantContext.runAsSystem(() =>
      tx.tenantMembership.updateManyAndReturn({
        where: { userId },
        data: { authVersion: { increment: 1 } },
        select: { tenantId: true },
      }),
    );
    return rows.map((r) => r.tenantId);
  }

  /** Tenant context: adds the user to the current tenant as an active member. */
  create(db: PrismaTx, userId: string) {
    return db.tenantMembership.create({
      data: { userId, tenantId: TenantContext.requireTenantId() },
      select: { authVersion: true },
    });
  }
}
