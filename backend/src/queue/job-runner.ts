import { UnrecoverableError } from 'bullmq';
import { TenantContext } from '../tenancy/tenant-context.js';
import {
  InvalidJobPayloadError,
  InvalidJobTenantError,
} from './queue.errors.js';
import type { JobContext, JobDefinition, JobHandler } from './queue.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTenantId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export interface RunnerDeps {
  /** Runs inside the job's tenant context; true when the tenant exists and is active. */
  isTenantActive(tenantId: string): Promise<boolean>;
}

/**
 * Runs one job. The handler only ever runs inside TenantContext.run(tenantId):
 * a job without a valid, active tenant is refused with UnrecoverableError
 * (BullMQ then skips the remaining retries and keeps it as failed), never run
 * in system context. Handler errors are rethrown so BullMQ retries them.
 */
export async function runJob<P>(
  definition: JobDefinition<P>,
  handler: JobHandler<P>,
  data: unknown,
  meta: Omit<JobContext, 'tenantId'>,
  deps: RunnerDeps,
): Promise<void> {
  const envelope = (data ?? {}) as { tenantId?: unknown; payload?: unknown };
  const tenantId = envelope.tenantId;
  if (!isTenantId(tenantId)) {
    throw unrecoverable(new InvalidJobTenantError('missing or malformed'));
  }

  await TenantContext.run(tenantId, async () => {
    if (!(await deps.isTenantActive(tenantId))) {
      throw unrecoverable(new InvalidJobTenantError('unknown or inactive'));
    }
    let payload: P;
    try {
      payload = definition.parse
        ? definition.parse(envelope.payload)
        : (envelope.payload as P);
    } catch {
      throw unrecoverable(new InvalidJobPayloadError());
    }
    try {
      await handler(payload, { ...meta, tenantId });
    } catch (error) {
      throw handlerFailure(error);
    }
  });
}

/**
 * BullMQ stores the thrown error's message as failedReason and its stack in
 * Redis, where they stay with the dead letter. Handler messages may carry
 * secrets, so only a code is kept: `JOB_FAILED:<code>`, no stack.
 */
function handlerFailure(error: unknown): Error {
  const code =
    error instanceof UnrecoverableError
      ? 'UNRECOVERABLE'
      : error instanceof Error
        ? errorCode(error)
        : 'UNKNOWN';
  const failure =
    error instanceof UnrecoverableError
      ? new UnrecoverableError(`JOB_FAILED:${code}`)
      : new Error(`JOB_FAILED:${code}`);
  return withoutStack(failure);
}

/** Refusals store only their code, e.g. "INVALID_JOB_TENANT". */
function unrecoverable(error: Error & { code: string }): UnrecoverableError {
  return withoutStack(new UnrecoverableError(error.code));
}

function withoutStack<E extends Error>(error: E): E {
  error.stack = '';
  return error;
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Messages this module produces: `CODE` or `JOB_FAILED:<code>`. */
const OWN_MESSAGE = /^[A-Z][A-Z0-9_]{0,63}(:[A-Za-z0-9_]{1,64})?$/;

/**
 * A safe error code: the error's `code` when it looks like one (e.g. ETIMEDOUT),
 * our own code-only message, else the class name. Never the free-text message.
 */
export function errorCode(error: Error): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CODE.test(code)) return code;
  if (OWN_MESSAGE.test(error.message)) return error.message;
  return /^[A-Za-z0-9_]{1,64}$/.test(error.name) ? error.name : 'Error';
}
