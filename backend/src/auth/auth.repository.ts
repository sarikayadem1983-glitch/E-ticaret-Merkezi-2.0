import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/** Data access for users, roles, user_roles and refresh_tokens. All calls are tenant-scoped by the Prisma extension. */
@Injectable()
export class AuthRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  /** System context only: login resolves the tenant from the email. */
  findUserForLogin(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        passwordHash: true,
        isActive: true,
      },
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
      },
    });
  }

  createUser(
    db: PrismaTx,
    data: { name: string; email: string; passwordHash: string },
  ) {
    return db.user.create({
      data: { ...data, tenantId: TenantContext.requireTenantId() },
      select: { id: true },
    });
  }

  createRole(db: PrismaTx, data: { name: string; permissions: string[] }) {
    return db.role.create({
      data: { ...data, tenantId: TenantContext.requireTenantId() },
      select: { id: true },
    });
  }

  assignRole(db: PrismaTx, userId: string, roleId: string) {
    return db.userRole.create({
      data: { userId, roleId, tenantId: TenantContext.requireTenantId() },
    });
  }

  findActiveUser(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, isActive: true, deletedAt: null },
      select: { id: true, tenantId: true, name: true, email: true },
    });
  }

  async findPermissions(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { permissions: true } } },
    });
    return [...new Set(rows.flatMap((r) => r.role.permissions))];
  }

  touchLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
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

  revokeByHash(userId: string, tokenHash: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
