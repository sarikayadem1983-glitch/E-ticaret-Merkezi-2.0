import { createHash, randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { waitForReady } from '../rate-limit/redis.provider.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { scanFailed } from './dead-letters.js';
import { errorCode, isTenantId, runJob } from './job-runner.js';
import {
  CONNECT_TIMEOUT_MS,
  ENQUEUE_TIMEOUT_MS,
  producerConnection,
  QUEUE_PREFIX,
  workerConnection,
} from './queue.connection.js';
import { QueueUnavailableError } from './queue.errors.js';
import {
  type DeadLetterPage,
  DEFAULT_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  type JobDefinition,
  type JobEnvelope,
  type JobHandler,
} from './queue.types.js';

/** Completed jobs are kept this long: the idempotency window after success. */
export const COMPLETED_RETENTION_S = 7 * 24 * 3600;
/** Dead letters (failed after all attempts, or refused) are kept this long. */
export const FAILED_RETENTION_S = 30 * 24 * 3600;
/** Default wait for active jobs on shutdown before they are force-closed. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface EnqueueOptions {
  /**
   * Required. The same key (per job definition and tenant) runs once while the
   * earlier job is kept: waiting, delayed, active, completed (7 days) or failed (30 days).
   */
  idempotencyKey: string;
  /** Delay before the first run. */
  delayMs?: number;
}

export interface EnqueueResult {
  jobId: string;
  /** True when a job with the same key already existed; nothing new was queued. */
  duplicate: boolean;
}

/** Stored envelope plus a per-enqueue nonce used to detect duplicates. */
interface StoredEnvelope<P> extends JobEnvelope<P> {
  nonce: string;
}

/**
 * Reusable job queue on BullMQ. Every job carries the tenant of the context it
 * was enqueued from; the worker runs the handler inside TenantContext.run for
 * that tenant and refuses jobs without a valid, active tenant.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private readonly url: string;
  private readonly workersEnabled: boolean;
  private producer: Redis | undefined;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<
    string,
    { worker: Worker | undefined; redis: Redis | undefined }
  >();
  private readonly shutdownTimeoutMs: number;
  private closing = false;

  constructor(
    config: ConfigService,
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly tenants: TenantsService,
  ) {
    this.url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.workersEnabled = config.get<string>('QUEUE_WORKERS') !== 'false';
    const timeout = Number(config.get<string>('QUEUE_SHUTDOWN_TIMEOUT_MS'));
    this.shutdownTimeoutMs =
      Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  /**
   * Connects the producer at startup (bounded) so the first enqueue does not
   * race the initial connect. If Redis is down the app still starts and
   * enqueue fails with QueueUnavailableError until it comes back.
   */
  async onModuleInit(): Promise<void> {
    if (!(await waitForReady(this.connection(), CONNECT_TIMEOUT_MS))) {
      this.logger.error(
        'Queue Redis is not ready at startup; enqueue fails until it connects',
      );
    }
  }

  /**
   * Starts a worker for the definition. Call once per definition, typically in
   * the owning module's onModuleInit. Does not start a worker when
   * QUEUE_WORKERS=false (API-only instance).
   */
  register<P>(definition: JobDefinition<P>, handler: JobHandler<P>): void {
    if (this.workers.has(definition.name)) {
      throw new Error(`Handler already registered: ${definition.name}`);
    }
    if (!this.workersEnabled || this.closing) {
      this.workers.set(definition.name, {
        worker: undefined,
        redis: undefined,
      });
      return;
    }
    const redis = workerConnection(this.url);
    // Errors are reported once by the worker's error handler below.
    redis.on('error', () => undefined);
    const worker = new Worker(
      definition.name,
      (job: Job) =>
        runJob(
          definition,
          handler,
          job.data,
          { jobId: job.id ?? '', attempt: job.attemptsMade + 1 },
          {
            isTenantActive: (tenantId) =>
              this.tenants.isActive(this.prisma, tenantId),
          },
        ),
      {
        connection: redis,
        prefix: QUEUE_PREFIX,
        concurrency: definition.concurrency ?? 1,
      },
    );
    let down = false;
    worker.on('error', (error) => {
      if (!down) {
        this.logger.error(
          `Worker ${definition.name} Redis error: ${error.message}`,
        );
      }
      down = true;
    });
    worker.on('ready', () => {
      if (down) this.logger.log(`Worker ${definition.name} reconnected`);
      down = false;
    });
    worker.on('failed', (job, error) =>
      this.logFailure(definition, job, error),
    );
    this.workers.set(definition.name, { worker, redis });
  }

  /**
   * Queues a job for the CURRENT tenant (TenantContext). There is no way to
   * enqueue for another tenant or without one. Fails fast with
   * QueueUnavailableError when Redis is unreachable.
   */
  async enqueue<P>(
    definition: JobDefinition<P>,
    payload: P,
    options: EnqueueOptions,
  ): Promise<EnqueueResult> {
    const tenantId = TenantContext.requireTenantId();
    if (!options.idempotencyKey) throw new Error('idempotencyKey is required');
    const queue = this.queue(definition);
    if (this.connection().status !== 'ready') {
      throw new QueueUnavailableError(definition.name, 'Redis bağlantısı yok');
    }
    const jobId = jobIdFor(definition, tenantId, options.idempotencyKey);
    const envelope: StoredEnvelope<P> = {
      tenantId,
      payload,
      nonce: randomUUID(),
    };
    const stored = await withTimeout(
      (async () => {
        await queue.add(definition.name, envelope, {
          jobId,
          attempts: definition.attempts ?? DEFAULT_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: definition.backoffMs ?? DEFAULT_BACKOFF_MS,
          },
          delay: options.delayMs,
          removeOnComplete: { age: COMPLETED_RETENTION_S },
          removeOnFail: { age: FAILED_RETENTION_S },
          // No stack traces in Redis: they can quote handler data.
          stackTraceLimit: 0,
        });
        // For a known id BullMQ keeps the existing job and returns a local copy
        // of OUR data, so read back what is stored to tell a duplicate apart.
        return queue.getJob(jobId);
      })(),
      ENQUEUE_TIMEOUT_MS,
      () => new QueueUnavailableError(definition.name, 'zaman aşımı'),
    ).catch((error: unknown) => {
      if (error instanceof QueueUnavailableError) throw error;
      throw new QueueUnavailableError(
        definition.name,
        error instanceof Error ? error.message : 'bilinmeyen hata',
      );
    });
    const storedNonce = (stored?.data as StoredEnvelope<P> | undefined)?.nonce;
    // A missing job means ours already ran and was removed; it was not a duplicate.
    return {
      jobId,
      duplicate: stored !== undefined && storedNonce !== envelope.nonce,
    };
  }

  /**
   * Dead letters of the current tenant, newest first. Reads the failed set in
   * bounded batches (at most 2000 jobs per call, whatever other tenants have
   * there); continue with `nextCursor`. Returns codes only, never messages.
   */
  async deadLetters<P>(
    definition: JobDefinition<P>,
    page: { limit?: number; cursor?: number } = {},
  ): Promise<DeadLetterPage<P>> {
    const tenantId = TenantContext.requireTenantId();
    const queue = this.queue(definition);
    return scanFailed<P>(
      (start, end) => queue.getFailed(start, end),
      tenantId,
      page,
    );
  }

  /** Re-queues a dead letter of the current tenant. False when not found or not its own. */
  async retryDeadLetter<P>(
    definition: JobDefinition<P>,
    jobId: string,
  ): Promise<boolean> {
    const tenantId = TenantContext.requireTenantId();
    const job = await this.queue(definition).getJob(jobId);
    if (!job || (job.data as JobEnvelope)?.tenantId !== tenantId) return false;
    if (!(await job.isFailed())) return false;
    await job.retry('failed', { resetAttemptsMade: true });
    return true;
  }

  /** 'up' when the producer reaches Redis (fails within ~1 s otherwise). */
  async health(): Promise<'up' | 'down'> {
    try {
      const redis = this.connection();
      if (redis.status !== 'ready') return 'down';
      await redis.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  /**
   * Graceful shutdown: refuse new jobs and let active jobs finish, for at most
   * QUEUE_SHUTDOWN_TIMEOUT_MS (default 10 s). After that, or when Redis is
   * down, workers are force-closed and connections dropped. A job cut off this
   * way is detected as stalled by BullMQ and run again by another worker.
   */
  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    await Promise.allSettled(
      [...this.workers.entries()].map(async ([name, { worker, redis }]) => {
        if (worker) {
          const graceful = await withTimeout(
            worker.close().then(() => true),
            this.shutdownTimeoutMs,
            () => new Error('timeout'),
          ).catch(() => false);
          if (!graceful) {
            this.logger.warn(
              `Worker ${name} did not stop in ${this.shutdownTimeoutMs} ms; force-closing`,
            );
            // Not awaited: with Redis down even a forced close may wait on the socket.
            void worker.close(true).catch(() => undefined);
          }
        }
        redis?.disconnect();
      }),
    );
    await Promise.allSettled(
      [...this.queues.values()].map((q) =>
        withTimeout(q.close(), 1000, () => new Error('timeout')),
      ),
    );
    this.producer?.disconnect();
  }

  private connection(): Redis {
    if (!this.producer) {
      const producer = producerConnection(this.url);
      let down = false;
      producer.on('error', (error: Error) => {
        if (!down) this.logger.error(`Queue Redis error: ${error.message}`);
        down = true;
      });
      producer.on('ready', () => {
        if (down) this.logger.log('Queue Redis connection restored');
        down = false;
      });
      this.producer = producer;
    }
    return this.producer;
  }

  private queue(definition: JobDefinition<unknown>): Queue {
    if (this.closing) {
      throw new QueueUnavailableError(definition.name, 'kapanıyor');
    }
    let queue = this.queues.get(definition.name);
    if (!queue) {
      queue = new Queue(definition.name, {
        connection: this.connection(),
        prefix: QUEUE_PREFIX,
      });
      // Logged once by the producer connection handler.
      queue.on('error', () => undefined);
      this.queues.set(definition.name, queue);
    }
    return queue;
  }

  /** Never logs payloads or error messages (they may carry secrets); only codes. */
  private logFailure(
    definition: JobDefinition<unknown>,
    job: Job | undefined,
    error: Error,
  ): void {
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? 0;
    const final = error instanceof UnrecoverableError || made >= attempts;
    const tenantId = (job?.data as JobEnvelope | undefined)?.tenantId;
    // Only a well-formed id is logged: the raw value may be attacker-controlled.
    const tenant = isTenantId(tenantId) ? tenantId : 'invalid';
    const line = `queue=${definition.name} job=${job?.id} tenant=${tenant} attempt=${made}/${attempts} error=${errorCode(error)}`;
    if (final) this.logger.error(`Job dead-lettered: ${line}`);
    else this.logger.warn(`Job failed, will retry: ${line}`);
  }
}

/** Deterministic per (definition, tenant, key). Hashed: BullMQ ids cannot contain ':'. */
export function jobIdFor(
  definition: JobDefinition<unknown>,
  tenantId: string,
  key: string,
): string {
  return createHash('sha256')
    .update(`${definition.name}\0${tenantId}\0${key}`)
    .digest('hex');
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
