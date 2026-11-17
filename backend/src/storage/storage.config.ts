/**
 * Object storage settings (INF-12), parsed and validated once at startup. Invalid values
 * stop the app. Storage is optional outside production: without STORAGE_BUCKET the app
 * starts and every storage call fails with a clear 503. Production requires it.
 */
export interface StorageConfig {
  /** S3-compatible endpoint (MinIO in dev). Undefined: the provider's default (AWS). */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO and most self-hosted S3 need path-style URLs (http://host/bucket/key). */
  forcePathStyle: boolean;
  /** Lifetime of a signed download URL, seconds. */
  signedUrlTtlSeconds: number;
}

type Env = Record<string, string | undefined>;

export class StorageConfigError extends Error {}

export const DEFAULT_SIGNED_URL_TTL = 300;
export const MAX_SIGNED_URL_TTL = 3600;
/** S3 bucket naming rules (lowercase, digits, dots, hyphens; 3–63). */
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function parseBoolean(
  name: string,
  value: string | undefined,
  fallback: boolean,
) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new StorageConfigError(`${name} true/false olmalı`);
}

function parseEndpoint(value: string | undefined, production: boolean) {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorageConfigError('STORAGE_ENDPOINT geçerli bir URL olmalı');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new StorageConfigError('STORAGE_ENDPOINT http(s) olmalı');
  }
  if (production && url.protocol !== 'https:') {
    throw new StorageConfigError("Production'da STORAGE_ENDPOINT https olmalı");
  }
  if (url.username || url.password) {
    throw new StorageConfigError(
      'STORAGE_ENDPOINT içinde kullanıcı adı/şifre olamaz; STORAGE_ACCESS_KEY kullanın',
    );
  }
  return url.origin;
}

function parseTtl(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_SIGNED_URL_TTL;
  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_SIGNED_URL_TTL) {
    throw new StorageConfigError(
      `STORAGE_SIGNED_URL_TTL 1–${MAX_SIGNED_URL_TTL} saniye olmalı`,
    );
  }
  return ttl;
}

/** Returns undefined when storage is not configured (allowed only outside production). */
export function loadStorageConfig(env: Env): StorageConfig | undefined {
  const production = env.NODE_ENV === 'production';
  const bucket = env.STORAGE_BUCKET?.trim() ?? '';
  if (!bucket) {
    if (production) {
      throw new StorageConfigError("Production'da STORAGE_BUCKET gerekli");
    }
    return undefined;
  }
  if (!BUCKET.test(bucket) || bucket.includes('..')) {
    throw new StorageConfigError(
      'STORAGE_BUCKET geçerli bir S3 kova adı olmalı',
    );
  }
  const accessKeyId = env.STORAGE_ACCESS_KEY ?? '';
  const secretAccessKey = env.STORAGE_SECRET_KEY ?? '';
  if (!accessKeyId || !secretAccessKey) {
    throw new StorageConfigError(
      'STORAGE_ACCESS_KEY ve STORAGE_SECRET_KEY birlikte verilmeli',
    );
  }
  const endpoint = parseEndpoint(env.STORAGE_ENDPOINT, production);
  return {
    endpoint,
    region: env.STORAGE_REGION?.trim() || 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: parseBoolean(
      'STORAGE_FORCE_PATH_STYLE',
      env.STORAGE_FORCE_PATH_STYLE,
      endpoint !== undefined,
    ),
    signedUrlTtlSeconds: parseTtl(env.STORAGE_SIGNED_URL_TTL),
  };
}
