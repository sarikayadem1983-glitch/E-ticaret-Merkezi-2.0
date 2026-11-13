import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
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
import { jobIdFor, QueueService } from '../queue/queue.service.js';
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
  MAX_RATE_WAIT_IN_PROCESS_MS,
  type SyncContext,
  type SyncHandler,
  type SyncKindOptions,
  type SyncQueuePayload,
  type SyncStatus,
  syncErrorMessage,
} from './sync.types.js';

const KIND = /^[a-z0-9][a-z0-9.-]{0,56}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** BullMQ states in which the owning queue job can still run the row. */
const LIVE_QUEUE_STATES = new Set([
  'waiting',
  'wait',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
]);

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * INT-02 sync engine. Each sync job is a sync_jobs row (state + log); the queue
 * job carries only the row id. The row's `run_token` names the one BullMQ job
 * that owns it: only that job may run or finish the row, so a stray or
 * duplicate queue job is a no-op. When the owning job fails for good, the
 * queue's final-failure hook closes the row; rows whose owning job is gone can
 * be retried. Every marketplace request takes budget from the account's
 * shared Redis bucket; credentials are decrypted per run.
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

  /**
   * Registers a sync kind and starts its worker. Call once per kind (module
   * init). `usesLiveApi` is the kind's own declaration: a kind that calls a
   * marketplace must set it, the engine cannot detect network use.
   */
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
      onFinalFailure: (raw, ctx) => this.abandon(raw, ctx.jobId, ctx.errorCode),
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

  /** Queue definition of a kind (tests and diagnostics). */
  definitionOf(kind: string): JobDefinition<SyncQueuePayload> | undefined {
    return this.kinds.get(kind)?.definition;
  }

  /** Starts a job on behalf of a user: requires channels:manage and an active account of the company. */
  async start(user: AuthUser, input: StartInput) {
    await this.channels.get(user, input.companyId, input.channelAccountId);
    try {
      return await this.startForAccount(input, user.sub);
    } catch (error) {
      if (error instanceof SyncError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: syncErrorMessage(error.code),
        });
      }
      throw error;
    }
  }

  /**
   * Starts a job in the current tenant without a user (scheduled pulls). The
   * caller must have resolved the account inside this tenant. The same key
   * returns the existing row and never queues it a second time.
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
    const tenantId = TenantContext.requireTenantId();
    const id = randomUUID();
    const runToken = jobIdFor(kind.definition, tenantId, id);
    const key = {
      channelAccountId: input.channelAccountId,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
    };
    // ON CONFLICT DO NOTHING on (tenant, account, kind, key): one row, whoever races.
    const { count } = await this.prisma.syncJob.createMany({
      data: [
        {
          id,
          tenantId,
          ...key,
          companyId: input.companyId,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
          createdBy,
          runToken,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) {
      const row = await this.prisma.syncJob.findFirstOrThrow({
        where: key,
        select: { id: true, companyId: true },
      });
      if (row.companyId !== input.companyId) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Bulunamadı',
        });
      }
      return { syncJobId: row.id, duplicate: true };
    }
    await this.enqueue(kind, id, id, runToken);
    return { syncJobId: id, duplicate: false };
  }

  async list(
    user: AuthUser,
    companyId: string,
    channelAccountId: string,
    query: { status?: SyncStatus; limit?: number; cursor?: string },
  ) {
    await this.channels.get(user, companyId, channelAccountId);
    const where = { companyId, channelAccountId };
    if (
      query.cursor &&
      (await this.prisma.syncJob.count({
        where: { ...where, id: query.cursor },
      })) === 0
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CURSOR',
        message: 'Geçersiz sayfa imleci',
      });
    }
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const rows = await this.prisma.syncJob.findMany({
      where: { ...where, ...(query.status ? { status: query.status } : {}) },
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
   * Re-queues a job. Allowed for `failed` rows, and for `queued`/`running`
   * rows whose owning queue job no longer exists or has ended (process died
   * before enqueue, job dropped by the queue). The switch is one conditional
   * UPDATE that also hands the row to a new queue job, so concurrent retries
   * start it once and the previous queue job can no longer run it.
   */
  async retry(
    user: AuthUser,
    companyId: string,
    channelAccountId: string,
    syncJobId: string,
  ): Promise<void> {
    await this.channels.get(user, companyId, channelAccountId);
    const where = { id: syncJobId, companyId, channelAccountId };
    const row = await this.prisma.syncJob.findFirst({
      where,
      select: { kind: true, status: true, runToken: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bulunamadı' });
    }
    const kind = this.kinds.get(row.kind);
    if (!kind) {
      throw new ConflictException({
        code: 'SYNC_UNKNOWN_KIND',
        message: syncErrorMessage('SYNC_UNKNOWN_KIND'),
      });
    }
    if (row.status === 'succeeded') throw notRetryable('SYNC_JOB_NOT_FAILED');
    if (row.status !== 'failed') {
      const state = row.runToken
        ? await this.queue.jobState(kind.definition, row.runToken)
        : 'missing';
      if (LIVE_QUEUE_STATES.has(state)) throw notRetryable('SYNC_JOB_ACTIVE');
    }
    const key = `${syncJobId}:retry:${randomUUID()}`;
    const runToken = jobIdFor(
      kind.definition,
      TenantContext.requireTenantId(),
      key,
    );
    const { count } = await this.prisma.syncJob.updateMany({
      where: { ...where, status: row.status, runToken: row.runToken },
      data: {
        status: 'queued',
        runToken,
        errorCode: null,
        finishedAt: null,
        stats: {},
      },
    });
    if (count === 0) {
      throw notRetryable(
        row.status === 'failed' ? 'SYNC_JOB_NOT_FAILED' : 'SYNC_JOB_ACTIVE',
      );
    }
    await this.enqueue(kind, syncJobId, key, runToken);
  }

  /**
   * Queues the row's owning job. On failure the row is failed only if it is
   * still waiting for exactly this job; if the job was in fact created (a
   * timeout after the write), it finds the row failed and does nothing.
   */
  private async enqueue(
    kind: RegisteredKind,
    syncJobId: string,
    idempotencyKey: string,
    runToken: string,
  ): Promise<void> {
    try {
      await this.queue.enqueue(
        kind.definition,
        { syncJobId },
        { idempotencyKey },
      );
    } catch {
      await this.prisma.syncJob.updateMany({
        where: { id: syncJobId, status: 'queued', runToken },
        data: {
          status: 'failed',
          errorCode: 'SYNC_QUEUE_UNAVAILABLE',
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException({
        code: 'SYNC_QUEUE_UNAVAILABLE',
        message: syncErrorMessage('SYNC_QUEUE_UNAVAILABLE'),
      });
    }
  }

  /** Final-failure hook: the owning queue job is dead, so its open row is closed. */
  private async abandon(
    raw: unknown,
    jobId: string,
    errorCode: string,
  ): Promise<void> {
    const syncJobId = (raw as { syncJobId?: unknown } | null)?.syncJobId;
    if (typeof syncJobId !== 'string' || !UUID.test(syncJobId)) return;
    const code = /^JOB_FAILED:([A-Z][A-Z0-9_]{0,63})$/.exec(errorCode)?.[1];
    await this.prisma.syncJob.updateMany({
      where: {
        id: syncJobId,
        runToken: jobId,
        status: { in: ['queued', 'running'] },
      },
      data: {
        status: 'failed',
        errorCode:
          code && code !== 'UNRECOVERABLE' ? code : 'SYNC_JOB_ABANDONED',
        finishedAt: new Date(),
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
    const owned = { id: job.id, runToken: context.jobId };
    // Only the owning queue job may run the row, and only while it is open.
    // A stalled redelivery keeps its job id, so it resumes a `running` row.
    const { count } = await this.prisma.syncJob.updateMany({
      where: { ...owned, status: { in: ['queued', 'running'] } },
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
    const finish = (status: 'succeeded' | 'failed', errorCode: string | null) =>
      this.prisma.syncJob.updateMany({
        where: { ...owned, status: 'running' },
        data: {
          status,
          errorCode,
          finishedAt: new Date(),
          stats: stats as unknown as Prisma.InputJsonValue,
        },
      });
    const fail = async (code: string): Promise<never> => {
      await finish('failed', code);
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
        // Short waits happen in process (the handler keeps its progress); only a
        // long wait defers the whole job.
        takeRate: async (tokens = 1) => {
          let waited = 0;
          for (;;) {
            const r = await this.limiter.take(
              account.channel,
              job.channelAccountId,
              tokens,
            );
            if (r.ok) return;
            if (waited + r.retryAfterMs > MAX_RATE_WAIT_IN_PROCESS_MS) {
              throw new SyncError(
                'CHANNEL_RATE_LIMITED',
                'rate_limited',
                r.retryAfterMs,
              );
            }
            await sleep(r.retryAfterMs);
            waited += r.retryAfterMs;
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
          this.refs.linkLocal(job.channelAccountId, refId, localId, tx),
      };
      await entry.handler(payload, ctx);
      await finish('succeeded', null);
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
          where: { ...owned, status: 'running' },
          data: {
            status: 'queued',
            attempts: { decrement: 1 },
            errorCode: failure.code,
            stats: { ...stats, rateLimitDeferrals: deferrals + 1 },
          },
        });
        // If the deferral itself fails, BullMQ counts an attempt; the final-failure
        // hook closes the row when attempts run out.
        if (context.defer) await context.defer(failure.retryAfterMs ?? 0);
        throw new Error(failure.code);
      }
      // transient
      const maxAttempts = entry.options.attempts ?? DEFAULT_ATTEMPTS;
      if (context.attempt >= maxAttempts) {
        await finish('failed', failure.code);
      } else {
        await this.prisma.syncJob.updateMany({
          where: { ...owned, status: 'running' },
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

function notRetryable(code: 'SYNC_JOB_NOT_FAILED' | 'SYNC_JOB_ACTIVE') {
  return new ConflictException({
    code,
    message:
      code === 'SYNC_JOB_ACTIVE'
        ? 'İş hâlâ kuyrukta veya çalışıyor'
        : 'Yalnızca başarısız işler yeniden denenebilir',
  });
}
