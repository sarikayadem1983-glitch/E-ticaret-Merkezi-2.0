import proxyaddr from 'proxy-addr';

/** HTTP security settings, parsed and validated once at startup. Invalid values stop the app. */
export interface SecurityConfig {
  production: boolean;
  /** Value for Express `trust proxy`: false, or a list of trusted proxy IPs/CIDRs/named subnets. */
  trustProxy: false | string[];
  enforceHttps: boolean;
  corsOrigins: string[];
  bodyLimit: string;
}

type Env = Record<string, string | undefined>;

/** Named subnets understood by proxy-addr. */
const NAMED_SUBNETS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const BODY_LIMIT = /^\d+(b|kb|mb)$/i;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export class SecurityConfigError extends Error {}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Only explicit proxy addresses are trusted. `true` and hop counts are refused:
 * they trust whatever X-Forwarded-For the client sends if the topology changes.
 */
export function parseTrustProxy(value: string | undefined): false | string[] {
  const entries = list(value);
  if (
    entries.length === 0 ||
    (entries.length === 1 && entries[0] === 'false')
  ) {
    return false;
  }
  for (const entry of entries) {
    if (entry === 'true' || /^\d+$/.test(entry)) {
      throw new SecurityConfigError(
        `TRUST_PROXY='${entry}' güvenli değil; proxy IP/CIDR listesi veya loopback/linklocal/uniquelocal kullanın`,
      );
    }
  }
  try {
    proxyaddr.compile(entries.filter((e) => !NAMED_SUBNETS.has(e)));
  } catch (error) {
    throw new SecurityConfigError(
      `TRUST_PROXY geçersiz: ${(error as Error).message}`,
    );
  }
  return entries;
}

export function parseCorsOrigins(
  value: string | undefined,
  production: boolean,
): string[] {
  const origins = list(value);
  for (const origin of origins) {
    if (origin === '*' || origin.includes('*')) {
      throw new SecurityConfigError('CORS_ORIGINS joker (*) içeremez');
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new SecurityConfigError(`CORS_ORIGINS geçersiz origin: ${origin}`);
    }
    if (url.origin !== origin) {
      throw new SecurityConfigError(
        `CORS_ORIGINS yalnızca origin içermeli (yol veya sondaki / olmadan): ${origin}`,
      );
    }
    if (production && url.protocol !== 'https:') {
      throw new SecurityConfigError(
        `Production'da CORS origin https olmalı: ${origin}`,
      );
    }
  }
  return origins;
}

export function parseBodyLimit(value: string | undefined): string {
  const limit = (value ?? '100kb').trim().toLowerCase();
  if (!BODY_LIMIT.test(limit)) {
    throw new SecurityConfigError(
      `BODY_LIMIT geçersiz: '${limit}' (örn. 100kb, 1mb)`,
    );
  }
  const n = Number.parseInt(limit, 10);
  const bytes = limit.endsWith('mb')
    ? n * 1024 * 1024
    : limit.endsWith('kb')
      ? n * 1024
      : n;
  if (bytes < 1 || bytes > MAX_BODY_BYTES) {
    throw new SecurityConfigError('BODY_LIMIT 1b ile 10mb arasında olmalı');
  }
  return limit;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new SecurityConfigError(`'${value}' true/false olmalı`);
}

export function loadSecurityConfig(env: Env): SecurityConfig {
  const production = env.NODE_ENV === 'production';
  // CORS_ORIGINS wins; FRONTEND_URL is kept as a single-origin fallback.
  const corsOrigins = parseCorsOrigins(
    env.CORS_ORIGINS ?? env.FRONTEND_URL,
    production,
  );
  const enforceHttps = parseBoolean(env.ENFORCE_HTTPS, production);
  if (production && !enforceHttps) {
    throw new SecurityConfigError("Production'da ENFORCE_HTTPS kapatılamaz");
  }
  return {
    production,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    enforceHttps,
    corsOrigins,
    bodyLimit: parseBodyLimit(env.BODY_LIMIT),
  };
}
