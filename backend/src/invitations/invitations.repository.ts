import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/** Stored shape of invitations.company_roles. */
export interface StoredCompanyRole {
  companyId: string;
  roleId: string;
}

const FIELDS = {
  id: true,
  tenantId: true,
  email: true,
  tenantRoleId: true,
  companyRoles: true,
  status: true,
  expiresAt: true,
  invitedByUserId: true,
  lastSentAt: true,
  sendAttempts: true,
  lastSendError: true,
  createdAt: true,
} as const;

export interface InvitationRow {
  id: string;
  tenantId: string;
  email: string;
  tenantRoleId: string | null;
  companyRoles: StoredCompanyRole[];
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: Date;
  invitedByUserId: string;
  lastSentAt: Date | null;
  sendAttempts: number;
  lastSendError: string | null;
  createdAt: Date;
}

const asRow = (
  row: Omit<InvitationRow, 'companyRoles'> & { companyRoles: unknown },
): InvitationRow => ({
  ...row,
  companyRoles: row.companyRoles as StoredCompanyRole[],
});

/**
 * Data access for invitations. Tenant-scoped by the Prisma extension, except
 * findUsableByTokenHash: a public token is resolved before any tenant is known.
 * token_hash is never selected back out.
 */
@Injectable()
export class InvitationsRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  create(
    tx: PrismaTx,
    data: {
      email: string;
      tenantRoleId: string | null;
      companyRoles: StoredCompanyRole[];
      tokenHash: string;
      expiresAt: Date;
      invitedByUserId: string;
    },
  ) {
    return tx.invitation.create({
      data: {
        ...data,
        companyRoles: data.companyRoles as unknown as object[],
        tenantId: TenantContext.requireTenantId(),
      },
      select: { id: true },
    });
  }

  async findById(
    id: string,
    db: PrismaTx = this.prisma,
  ): Promise<InvitationRow | null> {
    const row = await db.invitation.findFirst({
      where: { id },
      select: FIELDS,
    });
    return row && asRow(row);
  }

  async listPending(): Promise<InvitationRow[]> {
    const rows = await this.prisma.invitation.findMany({
      where: { status: 'pending' },
      select: FIELDS,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 500,
    });
    return rows.map(asRow);
  }

  /**
   * System context: the pending, unexpired invitation with this token hash.
   * The query filters by the hash itself; the caller switches to the
   * invitation's tenant for everything else.
   */
  async findUsableByTokenHash(
    tokenHash: string,
  ): Promise<InvitationRow | null> {
    const row = await TenantContext.runAsSystem(() =>
      this.prisma.invitation.findFirst({
        where: { tokenHash, status: 'pending', expiresAt: { gt: new Date() } },
        select: FIELDS,
      }),
    );
    return row && asRow(row);
  }

  /** Outcome of one delivery attempt. `error` is a short code, never the raw reply. */
  async recordSend(id: string, error: string | null) {
    await this.prisma.invitation.updateMany({
      where: { id },
      data: {
        sendAttempts: { increment: 1 },
        lastSendError: error,
        ...(error ? {} : { lastSentAt: new Date() }),
      },
    });
  }

  /** New token and expiry for a pending invitation; false when it is no longer pending. */
  async rotateToken(
    tx: PrismaTx,
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const { count } = await tx.invitation.updateMany({
      where: { id, status: 'pending' },
      data: { tokenHash, expiresAt },
    });
    return count === 1;
  }

  async revoke(tx: PrismaTx, id: string): Promise<boolean> {
    const { count } = await tx.invitation.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * Conditional pending → accepted transition. The row lock it takes makes a
   * concurrent accept wait and then match 0 rows, so a token is used once.
   */
  async claim(tx: PrismaTx, id: string, tokenHash: string): Promise<boolean> {
    const { count } = await tx.invitation.updateMany({
      where: {
        id,
        tokenHash,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    return count === 1;
  }

  async setAcceptedBy(tx: PrismaTx, id: string, userId: string) {
    await tx.invitation.updateMany({
      where: { id },
      data: { acceptedByUserId: userId },
    });
  }
}
