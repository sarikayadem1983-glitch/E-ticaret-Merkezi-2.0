import type { DeadLetter, DeadLetterPage, JobEnvelope } from './queue.types.js';

/** Minimal shape of a failed BullMQ job that the scan reads. */
export interface FailedJob {
  id?: string;
  data: unknown;
  attemptsMade: number;
  failedReason: string;
  finishedOn?: number;
}

export interface ScanLimits {
  /** Jobs read from Redis per round trip. */
  batchSize: number;
  /** Hard cap on jobs read per call, whatever the tenant's share. */
  maxScan: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  batchSize: 200,
  maxScan: 2000,
};
export const MAX_PAGE_SIZE = 100;

/**
 * Pages through the failed set (newest first) in bounded batches and keeps the
 * tenant's jobs. Reads at most `maxScan` jobs per call; when the cap or the
 * limit is hit, `nextCursor` is the index to continue from. The cursor is an
 * offset into a set that changes over time: a page may skip or repeat a job.
 */
export async function scanFailed<P>(
  getFailed: (start: number, end: number) => Promise<FailedJob[]>,
  tenantId: string,
  page: { limit?: number; cursor?: number },
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
): Promise<DeadLetterPage<P>> {
  const limit = Math.min(Math.max(1, page.limit ?? 50), MAX_PAGE_SIZE);
  const start = Math.max(0, Math.floor(page.cursor ?? 0));
  const items: DeadLetter<P>[] = [];
  let position = start;
  while (position - start < limits.maxScan) {
    const size = Math.min(limits.batchSize, start + limits.maxScan - position);
    const batch = await getFailed(position, position + size - 1);
    for (const job of batch) {
      position++;
      const envelope = job.data as JobEnvelope<P> | undefined;
      if (envelope?.tenantId !== tenantId) continue;
      items.push({
        id: job.id ?? '',
        tenantId,
        payload: envelope.payload,
        attemptsMade: job.attemptsMade,
        errorCode: job.failedReason,
        failedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      });
      if (items.length === limit) return { items, nextCursor: position };
    }
    if (batch.length < size) return { items, nextCursor: undefined };
  }
  return { items, nextCursor: position };
}
