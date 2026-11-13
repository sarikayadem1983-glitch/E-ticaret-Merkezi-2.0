import type { PrismaTx } from '../database/prisma.types.js';
import type { ClaimInput, ClaimResult } from './external-refs.repository.js';

export type SyncStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export const SYNC_STATUSES: readonly SyncStatus[] = [
  'queued',
  'running',
  'succeeded',
  'failed',
];

/** Counters a handler reports; shown in the sync log. */
export interface SyncStats {
  processed: number;
  created: number;
  updated: number;
  unchanged: number;
  stale: number;
  skipped: number;
}

export const emptyStats = (): SyncStats => ({
  processed: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  stale: 0,
  skipped: 0,
});

/** What a handler gets for one run. Credentials live only in memory for the run. */
export interface SyncContext {
  tenantId: string;
  companyId: string;
  channelAccountId: string;
  channel: string;
  syncJobId: string;
  /** 1 for the first run of this queue job, 2 for its first retry, ... */
  attempt: number;
  /** Decrypted credentials. Never log, store or return them. */
  credentials: Readonly<Record<string, string>>;
  /** True only when SYNC_LIVE_CALLS=true; adapters must not call a marketplace otherwise. */
  liveCallsAllowed: boolean;
  stats: SyncStats;
  /**
   * Takes request budget from the account's shared bucket before each
   * marketplace call. When the budget is spent the job is deferred (no attempt used).
   */
  takeRate(tokens?: number): Promise<void>;
  /** ExternalRefsRepository.claim plus stats bookkeeping. Pass `tx` to import atomically. */
  claim(
    input: Omit<ClaimInput, 'channelAccountId' | 'syncJobId'>,
    tx?: PrismaTx,
  ): Promise<ClaimResult>;
  linkLocal(refId: string, localId: string, tx?: PrismaTx): Promise<void>;
}

export type SyncHandler<P> = (payload: P, ctx: SyncContext) => Promise<void>;

export interface SyncKindOptions<P> {
  /** Total runs per queue job, first included. Default 5. */
  attempts?: number;
  backoffMs?: number;
  /** Validates sync_jobs.payload; throwing fails the job as SYNC_INVALID_PAYLOAD. */
  parse: (raw: unknown) => P;
  /** The handler calls the real marketplace API: refused unless SYNC_LIVE_CALLS=true. */
  usesLiveApi: boolean;
}

/** Only the row id travels through Redis; payload and credentials stay in Postgres. */
export interface SyncQueuePayload {
  syncJobId: string;
}

/** A job deferred for rate limits more often than this fails as CHANNEL_RATE_LIMITED. */
export const MAX_RATE_LIMIT_DEFERRALS = 20;
/** Upper bound for sync_jobs.payload (JSON text length). */
export const MAX_PAYLOAD_CHARS = 16_384;
/** takeRate waits in process up to this long in total; a longer wait defers the job. */
export const MAX_RATE_WAIT_IN_PROCESS_MS = 10_000;

/** Turkish messages for stored error codes. Unknown codes get a generic text. */
export const SYNC_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  CHANNEL_AUTH_FAILED:
    'Pazaryeri kimlik bilgilerini reddetti. Kanal hesabındaki API bilgilerini kontrol edin.',
  CHANNEL_FORBIDDEN:
    'Pazaryeri bu işlem için yetki vermedi (IP izni veya hesap yetkisi gerekebilir).',
  CHANNEL_RATE_LIMITED:
    'Pazaryeri istek sınırına takıldı; iş daha sonra tekrar denenebilir.',
  CHANNEL_TIMEOUT: 'Pazaryeri zamanında yanıt vermedi.',
  CHANNEL_ACCOUNT_INACTIVE: 'Kanal hesabı pasif veya silinmiş.',
  SYNC_LIVE_CALLS_DISABLED:
    'Canlı pazaryeri çağrıları kapalı (SYNC_LIVE_CALLS). Resmî limit doğrulanınca açılır.',
  SYNC_INVALID_PAYLOAD: 'İş verisi geçersiz.',
  SYNC_QUEUE_UNAVAILABLE: 'İş kuyruğa alınamadı; tekrar deneyin.',
  SYNC_RATE_LIMIT_UNAVAILABLE: 'Hız sınırı deposuna ulaşılamadı.',
  SYNC_UNKNOWN_KIND: 'Bu iş türü bu sürümde tanımlı değil.',
  SYNC_JOB_ABANDONED:
    'İş kuyrukta yarıda kaldı (süreç durdu veya tekrar hakkı bitti); yeniden deneyebilirsiniz.',
  SYNC_CREDENTIALS_UNAVAILABLE: 'Kanal kimlik bilgisi şu an çözülemedi.',
};

export function syncErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  if (SYNC_ERROR_MESSAGES[code]) return SYNC_ERROR_MESSAGES[code];
  if (code.startsWith('CHANNEL_HTTP_') || code.startsWith('NETWORK_')) {
    return 'Pazaryerine geçici olarak ulaşılamadı.';
  }
  if (code.startsWith('CHANNEL_REJECTED_')) {
    return 'Pazaryeri isteği reddetti; veriyi kontrol edin.';
  }
  return 'Senkron işi başarısız oldu.';
}
