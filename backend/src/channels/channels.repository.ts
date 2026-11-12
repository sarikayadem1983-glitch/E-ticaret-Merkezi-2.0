import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import type { EncryptedCredentials } from './credential-cipher.js';

/** Fields safe to return: no ciphertext, no key material. */
export const ACCOUNT_FIELDS = {
  id: true,
  companyId: true,
  channel: true,
  name: true,
  isActive: true,
  credentialsHint: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

export type AccountRow = Prisma.ChannelAccountGetPayload<{
  select: typeof ACCOUNT_FIELDS;
}>;

const SECRET_FIELDS = {
  id: true,
  tenantId: true,
  channel: true,
  credentialsCiphertext: true,
  credentialsIv: true,
  credentialsTag: true,
  wrappedDek: true,
  dekIv: true,
  dekTag: true,
  kekId: true,
  updatedAt: true,
} satisfies Prisma.ChannelAccountSelect;

type SecretRow = Prisma.ChannelAccountGetPayload<{
  select: typeof SECRET_FIELDS;
}>;

function toColumns(e: EncryptedCredentials) {
  return {
    credentialsCiphertext: new Uint8Array(e.ciphertext),
    credentialsIv: new Uint8Array(e.iv),
    credentialsTag: new Uint8Array(e.tag),
    wrappedDek: new Uint8Array(e.wrappedDek),
    dekIv: new Uint8Array(e.dekIv),
    dekTag: new Uint8Array(e.dekTag),
    kekId: e.kekId,
  };
}

export function toEncrypted(row: SecretRow): EncryptedCredentials {
  return {
    ciphertext: Buffer.from(row.credentialsCiphertext),
    iv: Buffer.from(row.credentialsIv),
    tag: Buffer.from(row.credentialsTag),
    wrappedDek: Buffer.from(row.wrappedDek),
    dekIv: Buffer.from(row.dekIv),
    dekTag: Buffer.from(row.dekTag),
    kekId: row.kekId,
  };
}

/** Data access for channel_accounts. Tenant-scoped by the Prisma extension. */
@Injectable()
export class ChannelsRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  list(companyId: string) {
    return this.prisma.channelAccount.findMany({
      where: { companyId, deletedAt: null },
      select: ACCOUNT_FIELDS,
      orderBy: [{ channel: 'asc' }, { name: 'asc' }],
    });
  }

  find(
    companyId: string,
    id: string,
    db: PrismaTx | TenantPrismaClient = this.prisma,
  ) {
    return db.channelAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      select: ACCOUNT_FIELDS,
    });
  }

  findSecret(companyId: string, id: string) {
    return this.prisma.channelAccount.findFirst({
      where: { id, companyId, deletedAt: null, isActive: true },
      select: SECRET_FIELDS,
    });
  }

  create(
    db: PrismaTx,
    data: {
      id: string;
      companyId: string;
      channel: string;
      name: string;
      encrypted: EncryptedCredentials;
      hint: Record<string, string>;
    },
  ) {
    return db.channelAccount.create({
      data: {
        id: data.id,
        tenantId: TenantContext.requireTenantId(),
        companyId: data.companyId,
        channel: data.channel,
        name: data.name,
        credentialsHint: data.hint,
        ...toColumns(data.encrypted),
      },
      select: ACCOUNT_FIELDS,
    });
  }

  /** Updates a live account; null when it was deleted or moved meanwhile. */
  async update(
    db: PrismaTx,
    companyId: string,
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      encrypted?: EncryptedCredentials;
      hint?: Record<string, string>;
    },
  ) {
    const { count } = await db.channelAccount.updateMany({
      where: { id, companyId, deletedAt: null },
      data: {
        name: data.name,
        isActive: data.isActive,
        credentialsHint: data.hint,
        ...(data.encrypted ? toColumns(data.encrypted) : {}),
      },
    });
    return count === 1 ? this.find(companyId, id, db) : null;
  }

  /**
   * Soft delete. The live row's key material is overwritten with random bytes,
   * so the API and adapters can no longer decrypt it. Old row versions, WAL and
   * backups still hold the previous bytes until vacuum/retention removes them;
   * with a local KEK they stay decryptable there. True crypto-shredding needs a
   * KMS (INF-13, R-25). See docs/SECURITY.md.
   */
  async softDelete(db: PrismaTx, companyId: string, id: string) {
    const { count } = await db.channelAccount.updateMany({
      where: { id, companyId, deletedAt: null },
      data: {
        deletedAt: new Date(),
        isActive: false,
        credentialsCiphertext: new Uint8Array(randomBytes(1)),
        wrappedDek: new Uint8Array(randomBytes(32)),
        credentialsHint: {},
      },
    });
    return count === 1;
  }

  /** Accounts of the current tenant whose DEK is wrapped with another KEK. */
  /** Keyset page (id order) so every row is visited once per run. */
  findForRewrap(activeKekId: string, afterId: string | null, take: number) {
    return this.prisma.channelAccount.findMany({
      where: {
        kekId: { not: activeKekId },
        deletedAt: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: SECRET_FIELDS,
      orderBy: { id: 'asc' },
      take,
    });
  }

  /** Compare-and-set: only when the row is unchanged since it was read. */
  saveRewrap(
    row: Pick<SecretRow, 'id' | 'kekId' | 'updatedAt'>,
    w: Pick<EncryptedCredentials, 'wrappedDek' | 'dekIv' | 'dekTag' | 'kekId'>,
  ) {
    return this.prisma.channelAccount.updateMany({
      where: {
        id: row.id,
        kekId: row.kekId,
        updatedAt: row.updatedAt,
        deletedAt: null,
      },
      data: {
        wrappedDek: new Uint8Array(w.wrappedDek),
        dekIv: new Uint8Array(w.dekIv),
        dekTag: new Uint8Array(w.dekTag),
        kekId: w.kekId,
      },
    });
  }
}
