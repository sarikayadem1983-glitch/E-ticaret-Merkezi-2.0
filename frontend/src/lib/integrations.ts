/** INT-03 integrations: shapes returned by the backend and pure helpers for the UI. */

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  maxLength: number;
}

export interface ChannelDefinition {
  code: string;
  name: string;
  credentialFields: CredentialField[];
  connectionTest: boolean;
}

export interface ChannelAccount {
  id: string;
  companyId: string;
  channel: string;
  name: string;
  isActive: boolean;
  /** Masked display values ("••••1234"); secrets never come back. */
  credentials: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type SyncStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface SyncJob {
  id: string;
  kind: string;
  status: SyncStatus;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  stats: Record<string, number>;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  code: string;
  message: string;
}

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  queued: 'Kuyrukta',
  running: 'Çalışıyor',
  succeeded: 'Başarılı',
  failed: 'Başarısız',
};

/**
 * Credentials to send. On create every field is required. On edit the user
 * replaces credentials as a whole (the backend never patches secrets), so all
 * fields must be filled again, or none (keep the stored ones → undefined).
 */
export function buildCredentials(
  fields: CredentialField[],
  values: Record<string, string>,
  mode: 'create' | 'edit',
): { credentials?: Record<string, string>; error?: string } {
  const trimmed = Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()]));
  const filled = fields.filter((f) => trimmed[f.key] !== '');
  if (mode === 'edit' && filled.length === 0) return {};
  const missing = fields.filter((f) => trimmed[f.key] === '');
  if (missing.length > 0) {
    return {
      error:
        mode === 'edit'
          ? `Kimlik bilgilerini değiştirmek için tüm alanları doldurun: ${missing.map((f) => f.label).join(', ')}`
          : `Zorunlu alan: ${missing.map((f) => f.label).join(', ')}`,
    };
  }
  const tooLong = fields.find((f) => trimmed[f.key].length > f.maxLength);
  if (tooLong)
    return {
      error: `${tooLong.label} en fazla ${tooLong.maxLength} karakter olabilir`,
    };
  return { credentials: trimmed };
}

/** Short summary of a job's counters, e.g. "3 işlendi · 2 yeni · 1 güncellendi". */
export function statsSummary(stats: Record<string, number>): string {
  const parts: [string, string][] = [
    ['processed', 'işlendi'],
    ['created', 'yeni'],
    ['updated', 'güncellendi'],
    ['unchanged', 'değişmedi'],
    ['stale', 'eski sürüm'],
    ['skipped', 'atlandı'],
  ];
  return parts
    .filter(([key]) => (stats[key] ?? 0) > 0)
    .map(([key, label]) => `${stats[key]} ${label}`)
    .join(' · ');
}
