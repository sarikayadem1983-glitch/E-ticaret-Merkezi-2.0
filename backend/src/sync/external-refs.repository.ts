import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { SyncError } from './sync-errors.js';

export type ExternalEntityType = 'order' | 'product' | 'variant';

/**
 * - created: first time we see this external record.
 * - updated: newer content (different hash, not older than what we have).
 * - unchanged: same content as stored.
 * - stale: older than what we have (by externalUpdatedAt); ignored.
 */
export type RefDecision = 'created' | 'updated' | 'unchanged' | 'stale';

export interface ClaimInput {
  channelAccountId: string;
  entityType: ExternalEntityType;
  externalId: string;
  externalUpdatedAt: Date | null;
  /** sha256 hex of the normalised external payload. */
  payloadHash: string;
  syncJobId: string;
}

export interface ClaimResult {
  decision: RefDecision;
  refId: string;
  /** Local record id; null until the import finished (also after a crash mid-import). */
  localId: string | null;
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * channel_external_refs. Duplicate protection lives in the database: the unique
 * key (tenant, account, type, external id) plus single-statement inserts and
 * conditional updates, so concurrent jobs and retries cannot create a second row.
 *
 * Importers run claim → create local record → linkLocal in ONE transaction
 * (`tx`). A concurrent importer of the same record blocks on the unique key /
 * row lock and then sees the committed result; a crash rolls everything back.
 */
@Injectable()
export class ExternalRefsRepository {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  async claim(input: ClaimInput, tx?: PrismaTx): Promise<ClaimResult> {
    if (!HASH.test(input.payloadHash)) {
      throw new SyncError('SYNC_INVALID_PAYLOAD_HASH', 'permanent');
    }
    const db = tx ?? this.prisma;
    const key = {
      channelAccountId: input.channelAccountId,
      entityType: input.entityType,
      externalId: input.externalId,
    };
    // INSERT … ON CONFLICT DO NOTHING: exactly one concurrent caller gets count 1.
    const { count: inserted } = await db.channelExternalRef.createMany({
      data: [
        {
          tenantId: TenantContext.requireTenantId(),
          ...key,
          externalUpdatedAt: input.externalUpdatedAt,
          payloadHash: input.payloadHash,
          lastSyncJobId: input.syncJobId,
        },
      ],
      skipDuplicates: true,
    });
    let decision: RefDecision;
    if (inserted === 1) {
      decision = 'created';
    } else {
      // One UPDATE with the whole rule in WHERE: Postgres re-checks it after
      // taking the row lock, so two concurrent newer versions cannot both win
      // against a stale read, and an older version never overwrites a newer one.
      const notOlder =
        input.externalUpdatedAt === null
          ? { externalUpdatedAt: null }
          : {
              OR: [
                { externalUpdatedAt: null },
                { externalUpdatedAt: { lte: input.externalUpdatedAt } },
              ],
            };
      const { count: updated } = await db.channelExternalRef.updateMany({
        where: { ...key, payloadHash: { not: input.payloadHash }, ...notOlder },
        data: {
          payloadHash: input.payloadHash,
          externalUpdatedAt: input.externalUpdatedAt,
          lastSyncJobId: input.syncJobId,
        },
      });
      decision = updated === 1 ? 'updated' : 'unchanged';
    }
    const row = await db.channelExternalRef.findFirstOrThrow({
      where: key,
      select: { id: true, localId: true, payloadHash: true },
    });
    if (decision === 'unchanged' && row.payloadHash !== input.payloadHash) {
      decision = 'stale';
    }
    return { decision, refId: row.id, localId: row.localId };
  }

  /**
   * Links the local record once. Throws (rolling back the caller's transaction)
   * when another importer already linked a different record.
   */
  async linkLocal(
    refId: string,
    localId: string,
    tx?: PrismaTx,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const { count } = await db.channelExternalRef.updateMany({
      where: { id: refId, OR: [{ localId: null }, { localId }] },
      data: { localId },
    });
    if (count !== 1) {
      throw new SyncError('SYNC_EXTERNAL_REF_ALREADY_LINKED', 'transient');
    }
  }
}
