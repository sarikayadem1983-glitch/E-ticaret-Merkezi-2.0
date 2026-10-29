import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { ROLE_CATALOG, type RoleKey } from '../access/roles.catalog.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * Data access for users, roles, user_roles and refresh_tokens. Tenant-scoped by the
 * Prisma extension; User queries (global model) only work in system context.
 */
@Injectable()
export class AuthRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  /**
   * System context only: users are global (one identity across tenants).
   * Deactivated and soft-deleted users are returned too, so login runs the
   * same path for them and can audit the attempt; the caller refuses them.
   */
  findUserForLogin(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        passwordHash: true,
        lastTenantId: true,
        isActive: true,
        deletedAt: true,
      },
    });
  }

  /** System context only: global account state for refresh. */
  findUserState(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, deletedAt: true },
    });
  }

  /** System context only: refresh resolves the tenant from the token. */
  findRefreshToken(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        createdAt: true,
      },
    });
  }

  /** System context only. The deprecated users.tenant_id stays NULL. */
  createUser(
    db: PrismaTx,
    data: {
      name: string;
      email: string;
      passwordHash: string;
      lastTenantId: string;
    },
  ) {
    return db.user.create({ data, select: { id: true } });
  }

  /** Creates every catalog role for the current tenant in one query. */
  createSystemRoles(db: PrismaTx) {
    const tenantId = TenantContext.requireTenantId();
    return db.role.createManyAndReturn({
      data: (Object.keys(ROLE_CATALOG) as RoleKey[]).map((key) => ({
        tenantId,
        key,
        name: ROLE_CATALOG[key].name,
        scope: ROLE_CATALOG[key].scope,
        permissions: [...ROLE_CATALOG[key].permissions],
        isSystem: true,
      })),
      select: { id: true, key: true },
    });
  }

  assignRole(db: PrismaTx, userId: string, roleId: string) {
    return db.userRole.create({
      data: { userId, roleId, tenantId: TenantContext.requireTenantId() },
    });
  }

  /** System context only: users are global. */
  touchLastLogin(userId: string, tenantId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), lastTenantId: tenantId },
      select: { id: true },
    });
  }

  /** System context only: the store the next login opens by default. */
  setLastTenant(userId: string, tenantId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastTenantId: tenantId },
      select: { id: true },
    });
  }

  createRefreshToken(
    db: PrismaTx,
    data: { userId: string; tokenHash: string; expiresAt: Date },
  ) {
    return db.refreshToken.create({
      data: { ...data, tenantId: TenantContext.requireTenantId() },
      select: { id: true },
    });
  }

  /** Revokes only if still active; returns false when another request already used it. */
  async revokeRefreshToken(
    db: PrismaTx,
    id: string,
    replacedById: string | null,
  ): Promise<boolean> {
    const { count } = await db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById },
    });
    return count === 1;
  }

  /**
   * Undoes a tenant switch's revocation (INF-18): reactivates the old token
   * only while its successor is exactly `successorId`. Returns false otherwise.
   */
  async restoreSwitchedRefreshToken(
    db: PrismaTx,
    id: string,
    successorId: string,
  ): Promise<boolean> {
    const { count } = await db.refreshToken.updateMany({
      where: { id, replacedById: successorId, revokedAt: { not: null } },
      data: { revokedAt: null, replacedById: null },
    });
    return count === 1;
  }

  revokeByHash(userId: string, tokenHash: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * System context only (refresh token reuse): revokes every unrevoked refresh
   * token of the user in every tenant, inside the caller's transaction. The
   * query filters by userId itself. Returns the revoked count per tenant.
   */
  async revokeAllForUserEverywhere(
    tx: PrismaTx,
    userId: string,
  ): Promise<{ tenantId: string; count: number }[]> {
    if (!TenantContext.isSystem()) {
      throw new Error('revokeAllForUserEverywhere requires system context');
    }
    const rows = await tx.refreshToken.updateManyAndReturn({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
      select: { tenantId: true },
    });
    const counts = new Map<string, number>();
    for (const { tenantId } of rows) {
      counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
    }
    return [...counts].map(([tenantId, count]) => ({ tenantId, count }));
  }
}
