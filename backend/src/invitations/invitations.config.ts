export interface InvitationsConfig {
  ttlMs: number;
  /** Origin of the web app; links are `${appOrigin}/invite/<token>`. */
  appOrigin: string;
}

export const INVITATIONS_CONFIG = Symbol('INVITATIONS_CONFIG');

const MAX_TTL_HOURS = 30 * 24;

export function loadInvitationsConfig(
  env: Record<string, string | undefined>,
): InvitationsConfig {
  const raw = env.INVITATION_TTL_HOURS;
  const hours = raw === undefined || raw === '' ? 7 * 24 : Number(raw);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_TTL_HOURS) {
    throw new Error(
      `INVITATION_TTL_HOURS 1–${MAX_TTL_HOURS} arasında bir tam sayı olmalı`,
    );
  }
  const origin = env.APP_ORIGIN ?? env.FRONTEND_URL ?? 'http://localhost:3000';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('APP_ORIGIN geçerli bir origin olmalı');
  }
  if (url.origin !== origin) {
    throw new Error('APP_ORIGIN yalnızca origin içermeli (yol olmadan)');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error("Production'da APP_ORIGIN https olmalı");
  }
  return { ttlMs: hours * 60 * 60 * 1000, appOrigin: url.origin };
}
