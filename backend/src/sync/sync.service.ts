import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import type { AuthUser } from '../auth/decorators.js';
import { ChannelsService } from '../channels/channels.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { QueueService } from '../queue/queue.service.js';
import {
  DEFAULT_ATTEMPTS,
  defineJob,
  type JobContext,
  type JobDefinition,
} from '../queue/queue.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ChannelRateLimiter } from './channel-rate-limiter.js';
import { ExternalRefsRepository } from './external-refs.repository.js';
import { classifyFailure, SyncError } from './sync-errors.js';
import {
  emptyStats,
  MAX_PAYLOAD_CHARS,
  MAX_RATE_LIMIT_DEFERRALS,
  type SyncContext,
  type SyncHandler,
  type SyncKindOptions,
  type SyncQueuePayload,
  type SyncStats,
  type SyncStatus,
  syncErrorMessage,
} from './sync.types.js';

const KIND = /^[a-z0-9][a-z0-9.-]{0,56}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RegisteredKind {
  definition: JobDefinition<SyncQueuePayload>;
  options: SyncKindOptions<unknown>;
  handler: SyncHandler<unknown>;
}

export interface StartInput {
  companyId: string;
  channelAccountId: string;
  kind: string;
  payload: Record<string, unknown>;
  /** Same key for the same account and kind → the existing job is returned. */
  idempotencyKey: string;
}

const VIEW_FIELDS = {
  id: true,
  kind: true,
  status: true,
  attempts: true,
  errorCode: true,
  stats: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.SyncJobSelect;

type ViewRow = Prisma.SyncJobGetPayload<{ select: typeof VIEW_FIELDS }>;

/** API view of a job: no payload (may hold business data), message mapped from the code. */
function view(row: ViewRow) {
  return { ...row, errorMessage: syncErrorMessage(row.errorCode) };
}

function parseQueuePayload(raw: unknown): SyncQueuePayload {
  const id = (raw as { syncJobId?: unknown } | null)?.syncJobId;
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('invalid');
  return { syncJobId: id };
}

/**
 * INT-02 sync engine. Each sync job is a sync_jobs row (state + log); the queue
 * job carries only the row id. Marketplace modules register kinds
 * (`registerKind`) and start jobs (`start` / `startForAccount`). Every run is
 * in the job's tenant (QueueService), credentials are decrypted per run, every
 * marketplace request takes budget from the account's shared Redis bucket.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');
  private readonly kinds = new Map<string, RegisteredKind>();
  readonly liveCallsAllowed: boolean;

  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly queue: QueueService,
    private readonly channels: ChannelsService,
    private readonly limiter: ChannelRateLimiter,
    private readonly refs: ExternalRefsRepository,
    config: ConfigService,
  ) {
    this.liveCallsAllowed = config.get<string>('SYNC_LIVE_CALLS') === 'true';
  }

  /** Registers a sync kind and starts its worker. Call once per kind (module init). */
  registerKind<P>(
    kind: string,
    handler: SyncHandler<P>,
    options: SyncKindOptions<P>,
  ): void {
    if (!KIND.test(kind)) throw new Error(`Invalid sync kind: ${kind}`);
    if (this.kinds.has(kind)) throw new Error(`Sync kind registered: ${kind}`);
    const definition = defineJob<SyncQueuePayload>({
      name: `sync.${kind}`,
      attempts: options.attempts ?? DEFAULT_ATTEMPTS,
      backoffMs: options.backoffMs,
      parse: parseQueuePayload,
    });
    const entry: RegisteredKind = {
      definition,
      options: options as SyncKindOptions<unknown>,
      handler: handler as SyncHandler<unknown>,
    };
    this.kinds.set(kind, entry);
    this.queue.register(definition, (payload, context) =>
      this.run(entry, kind, payload, context),
    );
  }

  /** Starts a job on behalf of a user: requires channels:manage and an active account of the company. */
  async start(user: AuthUser, input: StartInput) {
    await this.channels.get(user, input.companyId, input.channelAccountId);
    return this.startForAccount(input, user.sub);
  }

  /**
   * Starts a job in the current tenant without a user (scheduled pulls). The
   * caller must have resolved the account inside this tenant.
   */
  async startForAccount(
    input: StartInput,
    createdBy: string | null = null,
  ): Promise<{ syncJobId: string; duplicate: boolean }> {
    const kind = this.kinds.get(input.kind);
    if (!kind) throw new SyncError('SYNC_UNKNOWN_KIND', 'permanent');
    let payload: unknown;
    try {
      payload = kind.options.parse(input.payload);
    } catch {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    if (JSON.stringify(payload ?? {}).length > MAX_PAYLOAD_CHARS) {
      throw new SyncError('SYNC_INVALID_PAYLOAD', 'permanent');
    }
    const key = {
      channelAccountId: input.channelAccountId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
    };
    // ON CONFLICT DO NOTHING on (tenant, account, kind, key): one row, whoever races.
    const { count } = await this.prisma.syncJob.createMany({
      data: [
        {
          tenantId: TenantContext.requireTenantId(),
          ...key,
          companyId: input.companyId,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          createdBy,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.prisma.syncJob.findFirstOrThrow({
      where: key,
      select: { id: true, status: true, companyId: true },
    });
    if (row.companyId !== input.companyId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bulunamadı' });
    }
    // A queued row is (re-)enqueued under its own id: idempotent in BullMQ too.
    if (row.status === 'queued') await this.enqueue(kind, row.id, row.id);
    return { syncJobId: row.id, duplicate: count === 0 };
  }

  async list(
    user: AuthUser,
    companyId: string,
    channelAccountId: string,
    query: { status?: SyncStatus; limit?: number; cursor?: string },
  ) {
    await this.channels.get(user, companyId, channelAccountId);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const rows = await this.prisma.syncJob.findMany({
      where: {
        companyId,
        channelAccountId,
        ...(query.status ? { status: query.status } : {}),
      },
      select: VIEW_FIELDS,
      orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      data: page.map(view),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /**
   * Re-queues a failed job. The failed → queued switch is one conditional
   * UPDATE: two concurrent retries (or a retry of a running job) cannot both win.
   */
  async retry(
    user: AuthUser,
    companyId: string,
    channelAccountId: string,
    syncJobId: string,
  ): Promise<void> {
    await this.channels.get(user, companyId, channelAccountId);
    const where = { id: syncJobId, companyId, channelAccountId };
    const { count } = await this.prisma.syncJob.updateMany({
      where: { ...where, status: 'failed' },
      data: {
        status: 'queued',
        errorCode: null,
        finishedAt: null,
        stats: {},
        queuedAt: new Date(),
      },
    });
    if (count === 0) {
      const exists = await this.prisma.syncJob.count({ where });
      if (exists === 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Bulunamadı',
        });
      }
      throw new ConflictException({
        code: 'SYNC_JOB_NOT_FAILED',
        message: 'Yalnızca başarısız işler yeniden denenebilir',
      });
    }
    const row = await this.prisma.syncJob.findFirstOrThrow({
      where,
      select: { kind: true },
    });
    const kind = this.kinds.get(row.kind);
    if (!kind) {
      await this.finish(syncJobId, 'failed', 'SYNC_UNKNOWN_KIND');
      throw new ConflictException({
        code: 'SYNC_UNKNOWN_KIND',
        message: syncErrorMessage('SYNC_UNKNOWN_KIND'),
      });
    }
    // Fresh queue job (new id): the old one keeps its own attempt history.
    await this.enqueue(kind, syncJobId, `${syncJobId}:retry:${randomUUID()}`);
  }

  private async enqueue(
    kind: RegisteredKind,
    syncJobId: string,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await this.queue.enqueue(
        kind.definition,
        { syncJobId },
        { idempotencyKey },
      );
    } catch {
      await this.finish(syncJobId, 'failed', 'SYNC_QUEUE_UNAVAILABLE');
      throw new ServiceUnavailableException({
        code: 'SYNC_QUEUE_UNAVAILABLE',
        message: syncErrorMessage('SYNC_QUEUE_UNAVAILABLE'),
      });
    }
  }

  private async finish(
    id: string,
    status: 'succeeded' | 'failed',
    errorCode: string | null,
    stats?: SyncStats & { rateLimitDeferrals?: number },
  ): Promise<void> {
    await this.prisma.syncJob.updateMany({
      where: { id },
      data: {
        status,
        errorCode,
        finishedAt: new Date(),
        ...(stats ? { stats: stats as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /** Queue handler. Runs inside the job's tenant context (QueueService). */
  private async run(
    entry: RegisteredKind,
    kind: string,
    { syncJobId }: SyncQueuePayload,
    context: JobContext,
  ): Promise<void> {
    const job = await this.prisma.syncJob.findFirst({
      where: { id: syncJobId },
      select: {
        id: true,
        kind: true,
        companyId: true,
        channelAccountId: true,
        payload: true,
        stats: true,
        startedAt: true,
        channelAccount: {
          select: { channel: true, isActive: true, deletedAt: true },
        },
      },
    });
    // Not in this tenant (or gone): nothing to run, never retried.
    if (!job || job.kind !== kind) {
      throw new UnrecoverableError('SYNC_JOB_NOT_FOUND');
    }
    // Only queued (or running after a crash) rows run; a finished row is a no-op,
    // so a duplicate queue job can never run a job twice after it ended.
    const { count } = await this.prisma.syncJob.updateMany({
      where: { id: job.id, status: { in: ['queued', 'running'] } },
      data: {
        status: 'running',
        attempts: { increment: 1 },
        startedAt: job.startedAt ?? new Date(),
        errorCode: null,
      },
    });
    if (count === 0) return;

    const deferrals =
      Number(
        (job.stats as { rateLimitDeferrals?: unknown }).rateLimitDeferrals,
      ) || 0;
    const stats = emptyStats();
    const fail = async (code: string): Promise<never> => {
      await this.finish(job.id, 'failed', code, stats);
      throw new UnrecoverableError(code);
    };

    const account = job.channelAccount;
    if (!account.isActive || account.deletedAt) {
      return fail('CHANNEL_ACCOUNT_INACTIVE');
    }
    if (entry.options.usesLiveApi && !this.liveCallsAllowed) {
      return fail('SYNC_LIVE_CALLS_DISABLED');
    }
    let payload: unknown;
    try {
      payload = entry.options.parse(job.payload);
    } catch {
      return fail('SYNC_INVALID_PAYLOAD');
    }

    try {
      let credentials: Record<string, string>;
      try {
        credentials = await this.channels.credentialsFor(
          job.companyId,
          job.channelAccountId,
        );
      } catch (error) {
        if (error instanceof NotFoundException) {
          return await fail('CHANNEL_ACCOUNT_INACTIVE');
        }
        throw new SyncError('SYNC_CREDENTIALS_UNAVAILABLE', 'transient');
      }
      const ctx: SyncContext = {
        tenantId: context.tenantId,
        companyId: job.companyId,
        channelAccountId: job.channelAccountId,
        channel: account.channel,
        syncJobId: job.id,
        attempt: context.attempt,
        credentials: Object.freeze({ ...credentials }),
        liveCallsAllowed: this.liveCallsAllowed,
        stats,
        takeRate: async (tokens = 1) => {
          const r = await this.limiter.take(
            account.channel,
            job.channelAccountId,
            tokens,
          );
          if (!r.ok) {
            throw new SyncError(
              'CHANNEL_RATE_LIMITED',
              'rate_limited',
              r.retryAfterMs,
            );
          }
        },
        claim: async (input, tx) => {
          const result = await this.refs.claim(
            {
              ...input,
              channelAccountId: job.channelAccountId,
              syncJobId: job.id,
            },
            tx,
          );
          stats.processed += 1;
          stats[result.decision] += 1;
          return result;
        },
        linkLocal: (refId, localId, tx) =>
          this.refs.linkLocal(refId, localId, tx),
      };
      await entry.handler(payload, ctx);
      await this.finish(job.id, 'succeeded', null, stats);
    } catch (error) {
      if (error instanceof UnrecoverableError) throw error;
      const failure = classifyFailure(error);
      if (failure.kind === 'auth' || failure.kind === 'permanent') {
        return fail(failure.code);
      }
      if (failure.kind === 'rate_limited') {
        if (deferrals + 1 > MAX_RATE_LIMIT_DEFERRALS) {
          return fail('CHANNEL_RATE_LIMITED');
        }
        // A deferral is not an attempt: undo the increment, keep the count.
        await this.prisma.syncJob.updateMany({
          where: { id: job.id },
          data: {
            status: 'queued',
            attempts: { decrement: 1 },
            errorCode: failure.code,
            stats: { ...stats, rateLimitDeferrals: deferrals + 1 },
          },
        });
        if (context.defer) await context.defer(failure.retryAfterMs ?? 0);
        throw new Error(failure.code);
      }
      // transient
      const maxAttempts = entry.options.attempts ?? DEFAULT_ATTEMPTS;
      if (context.attempt >= maxAttempts) {
        await this.finish(job.id, 'failed', failure.code, stats);
      } else {
        await this.prisma.syncJob.updateMany({
          where: { id: job.id },
          data: { status: 'queued', errorCode: failure.code },
        });
      }
      this.logger.warn(
        `Sync job ${job.id} (${kind}) attempt ${context.attempt}: ${failure.code}`,
      );
      throw new Error(failure.code);
    }
  }
}
