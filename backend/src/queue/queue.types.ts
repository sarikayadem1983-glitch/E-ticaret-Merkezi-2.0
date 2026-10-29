/** What is stored in Redis for every job. tenantId is always present. */
export interface JobEnvelope<P = unknown> {
  tenantId: string;
  payload: P;
}

export interface JobContext {
  tenantId: string;
  jobId: string;
  /** 1 for the first run, 2 for the first retry, ... */
  attempt: number;
}

export type JobHandler<P> = (payload: P, context: JobContext) => Promise<void>;

/**
 * A typed job. One definition owns one BullMQ queue (`name`). Payloads must
 * not contain secrets (tokens, passwords, marketplace credentials): they are
 * stored in Redis in clear text and kept in the dead-letter set. Handlers load
 * credentials at run time, inside the job's tenant context.
 */
export interface JobDefinition<P> {
  /** Queue name: lowercase letters, digits, `-` and `.`. */
  readonly name: string;
  /** Total runs including the first one. Default 5. */
  readonly attempts?: number;
  /** Base delay of the exponential backoff: delay * 2^(attempt-1). Default 1000 ms. */
  readonly backoffMs?: number;
  /** Jobs run in parallel per worker. Default 1. */
  readonly concurrency?: number;
  /**
   * Validates the stored payload before the handler sees it. Throwing marks the
   * job as invalid; it is dead-lettered without retries.
   */
  readonly parse?: (raw: unknown) => P;
}

export const DEFAULT_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 1000;

const NAME = /^[a-z0-9][a-z0-9.-]{0,62}$/;

export function defineJob<P>(definition: JobDefinition<P>): JobDefinition<P> {
  if (!NAME.test(definition.name)) {
    throw new Error(`Invalid job name: ${definition.name}`);
  }
  if (definition.attempts !== undefined && definition.attempts < 1) {
    throw new Error('attempts must be >= 1');
  }
  return Object.freeze({ ...definition });
}

/** A failed job kept for inspection. The payload is returned, never logged. */
export interface DeadLetter<P = unknown> {
  id: string;
  tenantId: string | undefined;
  payload: P | undefined;
  attemptsMade: number;
  failedReason: string;
  failedAt: Date | undefined;
}
