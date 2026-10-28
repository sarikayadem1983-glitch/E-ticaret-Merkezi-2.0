import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../common/request-context.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { AuditAction, Prisma } from '../generated/prisma/client.js';
import { type AuditFilter, AuditRepository } from './audit.repository.js';
import { diff, sanitize } from './audit.sanitizer.js';

export interface AuditEvent {
  action: AuditAction;
  /** Owning module, e.g. 'auth', 'companies'. */
  module: string;
  /** Entity name, e.g. 'User', 'Company'. */
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Overrides the request user, e.g. on login before a token exists. */
  actorUserId?: string | null;
}

const toJson = (value: unknown) =>
  sanitize(value) as Prisma.InputJsonValue | undefined;

/** Public API of the audit module. The only way any module writes audit logs. */
@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  /**
   * Writes one audit row in the current tenant context. Pass the transaction
   * client so the log commits or rolls back together with the change.
   */
  async record(event: AuditEvent, db?: PrismaTx): Promise<void> {
    const request = RequestContext.get();
    let before = event.before;
    let after = event.after;
    if (event.action === 'UPDATE' && isRecord(before) && isRecord(after)) {
      ({ before, after } = diff(before, after));
    }
    await this.repository.insert(
      {
        actorUserId:
          event.actorUserId !== undefined
            ? event.actorUserId
            : (request.userId ?? null),
        action: event.action,
        module: event.module,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        before: toJson(before),
        after: toJson(after),
        ipAddress: request.ipAddress ?? null,
        userAgent: request.userAgent ?? null,
      },
      db,
    );
  }

  async list(filter: AuditFilter, page: number, perPage: number) {
    const { items, total } = await this.repository.findPage(
      filter,
      page,
      perPage,
    );
    return { data: items, meta: { page, per_page: perPage, total } };
  }

  async get(id: string) {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('Kayıt bulunamadı');
    return { data: row };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
