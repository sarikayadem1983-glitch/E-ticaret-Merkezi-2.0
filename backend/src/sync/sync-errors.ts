/**
 * INT-02 failure classes. Every error that leaves a sync handler is reduced to
 * one of four kinds and a code; free-text messages (which may quote marketplace
 * responses or credentials) are never stored or logged.
 *
 * - transient: network errors, timeouts, HTTP 5xx → retried with backoff, bounded.
 * - rate_limited: HTTP 429 or our own limiter → deferred (Retry-After when given),
 *   does not spend an attempt; bounded by MAX_RATE_LIMIT_DEFERRALS.
 * - auth: HTTP 401/403, rejected credentials → not retried; the user fixes the account.
 * - permanent: validation / business rejection (4xx), bad payload → not retried.
 */
export type FailureKind = 'transient' | 'rate_limited' | 'auth' | 'permanent';

const CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

export class SyncError extends Error {
  constructor(
    readonly code: string,
    readonly kind: FailureKind,
    /** Only for rate_limited: how long to wait before the next try. */
    readonly retryAfterMs?: number,
  ) {
    super(CODE.test(code) ? code : 'SYNC_ERROR');
    this.name = 'SyncError';
  }
}

/** Fallback wait for a 429 without a usable Retry-After header. */
export const DEFAULT_RETRY_AFTER_MS = 10_000;
/** Upper bound for any Retry-After we honour (a hostile/buggy header cannot park a job for days). */
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

/**
 * Parses an HTTP Retry-After value: delta-seconds or an HTTP-date. Returns ms,
 * clamped to [0, MAX_RETRY_AFTER_MS]; undefined when absent or unparseable.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (text === '') return undefined;
  let ms: number;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    // HTTP-date only ("Fri, 13 Nov 2026 10:00:30 GMT"); Date.parse would accept "-5" as a year.
    if (
      !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
    ) {
      return undefined;
    }
    const at = Date.parse(text);
    if (Number.isNaN(at)) return undefined;
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/**
 * Turns a marketplace HTTP response status into a SyncError. Adapters call this
 * for every non-2xx response, passing the Retry-After header for 429.
 */
export function httpFailure(
  status: number,
  retryAfter?: string | null,
): SyncError {
  if (status === 429) {
    return new SyncError(
      'CHANNEL_RATE_LIMITED',
      'rate_limited',
      parseRetryAfter(retryAfter) ?? DEFAULT_RETRY_AFTER_MS,
    );
  }
  if (status === 401) return new SyncError('CHANNEL_AUTH_FAILED', 'auth');
  if (status === 403) return new SyncError('CHANNEL_FORBIDDEN', 'auth');
  if (status === 408) return new SyncError('CHANNEL_TIMEOUT', 'transient');
  if (status >= 500)
    return new SyncError(`CHANNEL_HTTP_${status}`, 'transient');
  if (status >= 400)
    return new SyncError(`CHANNEL_REJECTED_${status}`, 'permanent');
  return new SyncError('CHANNEL_UNEXPECTED_RESPONSE', 'transient');
}

const TRANSIENT_NETWORK = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Classifies anything a handler threw. Unknown errors are transient (retries are bounded). */
export function classifyFailure(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_NETWORK.has(code)) {
      return new SyncError(`NETWORK_${code}`, 'transient');
    }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return new SyncError('CHANNEL_TIMEOUT', 'transient');
    }
  }
  return new SyncError('SYNC_UNEXPECTED_ERROR', 'transient');
}
