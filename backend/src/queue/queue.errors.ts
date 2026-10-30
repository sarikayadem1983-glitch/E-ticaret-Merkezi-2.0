/** Redis for the queue is unreachable or the queue is shutting down. Enqueue fails fast. */
export class QueueUnavailableError extends Error {
  readonly code = 'QUEUE_UNAVAILABLE';
  constructor(queue: string, reason: string) {
    super(`Kuyruk kullanılamıyor (${queue}): ${reason}`);
  }
}

/**
 * The job's tenant is missing, malformed, unknown or inactive. The job is never
 * run (not even in system context) and goes straight to the dead-letter set.
 */
export class InvalidJobTenantError extends Error {
  readonly code = 'INVALID_JOB_TENANT';
  constructor(reason: string) {
    super(`Geçersiz iş tenant'ı: ${reason}`);
  }
}

/** Payload failed the definition's parse step. Retrying cannot fix it. */
export class InvalidJobPayloadError extends Error {
  readonly code = 'INVALID_JOB_PAYLOAD';
  constructor() {
    super('Geçersiz iş verisi');
  }
}
