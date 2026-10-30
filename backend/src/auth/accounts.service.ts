import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { DUMMY_HASH } from './auth.service.js';

export interface Account {
  id: string;
  name: string;
  /** False when deactivated or soft-deleted. */
  usable: boolean;
  passwordHash: string;
}

/**
 * Public API of the auth module for global accounts (users table). Users are
 * global, so every query here runs in system context and filters by the
 * e-mail or id it is given. Callers never see password hashes they did not ask
 * to verify.
 */
@Injectable()
export class AccountsService {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  /** The account with this (normalised) e-mail, or null. */
  async findByEmail(email: string): Promise<Account | null> {
    const user = await TenantContext.runAsSystem(() =>
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          passwordHash: true,
          isActive: true,
          deletedAt: true,
        },
      }),
    );
    return (
      user && {
        id: user.id,
        name: user.name,
        passwordHash: user.passwordHash,
        usable: user.isActive && user.deletedAt === null,
      }
    );
  }

  /**
   * True only for a usable account with the right password. An unknown
   * account is verified against a dummy hash, so timing reveals nothing.
   */
  async verifyPassword(
    account: Account | null,
    password: string,
  ): Promise<boolean> {
    const ok = await verify(account?.passwordHash ?? DUMMY_HASH, password);
    return ok && !!account?.usable;
  }

  /**
   * Tenant context, inside the caller's transaction: revokes every unrevoked
   * refresh token of the user in the current tenant only (the extension
   * filters by tenant). Returns the revoked count.
   */
  async revokeRefreshTokensInTenant(
    tx: PrismaTx,
    userId: string,
  ): Promise<number> {
    const { count } = await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  hashPassword(password: string): Promise<string> {
    return hash(password);
  }

  /**
   * Inside the caller's transaction: a new account whose e-mail is already
   * verified (it was proven by an invitation token).
   */
  create(
    tx: PrismaTx,
    data: {
      name: string;
      email: string;
      passwordHash: string;
      lastTenantId: string;
    },
  ): Promise<{ id: string }> {
    return TenantContext.runAsSystem(() =>
      tx.user.create({
        data: { ...data, emailVerifiedAt: new Date() },
        select: { id: true },
      }),
    );
  }

  /** Inside the caller's transaction. Keeps an earlier verification time. */
  async markEmailVerified(tx: PrismaTx, userId: string): Promise<void> {
    await TenantContext.runAsSystem(() =>
      tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      }),
    );
  }
}
