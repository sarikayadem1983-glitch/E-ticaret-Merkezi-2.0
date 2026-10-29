/** Mail settings, parsed and validated once at startup. Invalid values stop the app. */
export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS from the first byte (usually port 465). */
  secure: boolean;
  /** When not `secure`: refuse to send unless the server upgrades with STARTTLS. */
  requireTls: boolean;
  auth: { user: string; pass: string } | undefined;
  /** Connection, greeting and socket timeout; also the cap for one send. */
  timeoutMs: number;
}

export interface MailConfig {
  transport: 'smtp' | 'log';
  from: string;
  smtp: SmtpConfig | undefined;
}

type Env = Record<string, string | undefined>;

export class MailConfigError extends Error {}

export const MAIL_TIMEOUT_MS = 10_000;
const DEV_FROM = 'Ticaret Merkezi <no-reply@localhost>';
/** `Name <addr@host>` or a bare `addr@host`; no line breaks. */
const FROM = /^(?:[^<>\r\n]*<[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/;

function parseBoolean(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new MailConfigError(`${name} true/false olmalı`);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailConfigError('SMTP_PORT 1–65535 arasında bir sayı olmalı');
  }
  return port;
}

function parseSmtp(env: Env, production: boolean): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  if (!host)
    throw new MailConfigError('MAIL_TRANSPORT=smtp için SMTP_HOST gerekli');
  const secure = parseBoolean('SMTP_SECURE', env.SMTP_SECURE, false);
  const port = parsePort(env.SMTP_PORT, secure ? 465 : 587);
  const requireTls = parseBoolean(
    'SMTP_REQUIRE_TLS',
    env.SMTP_REQUIRE_TLS,
    production,
  );
  if (production && !secure && !requireTls) {
    throw new MailConfigError(
      "Production'da SMTP TLS zorunlu: SMTP_SECURE=true veya SMTP_REQUIRE_TLS=true",
    );
  }
  const user = env.SMTP_USER ?? '';
  const pass = env.SMTP_PASSWORD ?? '';
  if (!!user !== !!pass) {
    throw new MailConfigError('SMTP_USER ve SMTP_PASSWORD birlikte verilmeli');
  }
  return {
    host,
    port,
    secure,
    requireTls,
    auth: user ? { user, pass } : undefined,
    timeoutMs: MAIL_TIMEOUT_MS,
  };
}

/**
 * MAIL_TRANSPORT is `smtp` (default in production) or `log` (default
 * elsewhere; writes no message content). Production refuses `log` and plain
 * SMTP. Error messages never contain the SMTP password.
 */
export function loadMailConfig(env: Env): MailConfig {
  const production = env.NODE_ENV === 'production';
  const transport = (
    env.MAIL_TRANSPORT || (production ? 'smtp' : 'log')
  ).trim();
  if (transport !== 'smtp' && transport !== 'log') {
    throw new MailConfigError("MAIL_TRANSPORT 'smtp' veya 'log' olmalı");
  }
  if (production && transport === 'log') {
    throw new MailConfigError("Production'da MAIL_TRANSPORT=log kullanılamaz");
  }
  const from = env.MAIL_FROM?.trim() || (production ? '' : DEV_FROM);
  if (!from) throw new MailConfigError("Production'da MAIL_FROM gerekli");
  if (!FROM.test(from)) {
    throw new MailConfigError('MAIL_FROM geçerli bir gönderen adresi olmalı');
  }
  return {
    transport,
    from,
    smtp: transport === 'smtp' ? parseSmtp(env, production) : undefined,
  };
}
