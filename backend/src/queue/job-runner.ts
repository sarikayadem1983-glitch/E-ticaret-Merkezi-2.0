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
    await handler(payload, { ...meta, tenantId });
  });
}

/** Keeps the code in the stored failedReason, e.g. "INVALID_JOB_TENANT: ...". */
function unrecoverable(error: Error & { code: string }): UnrecoverableError {
  return new UnrecoverableError(`${error.code}: ${error.message}`);
}
