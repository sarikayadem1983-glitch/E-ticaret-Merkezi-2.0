import 'server-only';
import { cookies } from 'next/headers';
import {
  type ClientContext,
  backendFetch,
  refreshTokens,
} from './backend-client';
import { serverEnv } from './env';
import { errorResponse, unauthenticated } from './http';
import { readyRedis } from './redis';
import {
  SessionManager,
  SessionUnavailableError,
  type TokenPair,
  sessionFromTokens,
} from './session-manager';
import {
  ABSOLUTE_TIMEOUT_MS,
  type SessionData,
  SessionStore,
  isWellFormedSessionId,
} from './session-store';

/**
 * `__Host-` (production) makes the browser require Secure, Path=/ and no
 * Domain, so a subdomain can never set or overwrite the session cookie.
 */
export function sessionCookieName(): string {
  return serverEnv().production ? '__Host-tm_sid' : 'tm_sid';
}

export async function sessionStore(): Promise<SessionStore> {
  return new SessionStore(await readyRedis(), serverEnv().sessionSecret);
}

export async function readSessionId(): Promise<string | null> {
  const sid = (await cookies()).get(sessionCookieName())?.value;
  return isWellFormedSessionId(sid) ? sid : null;
}

/**
 * HttpOnly: JavaScript never sees it. SameSite=Lax: not sent on cross-site
 * POST/fetch, still sent when the user follows a link to the app (Strict would
 * show a signed-out page then). State-changing requests are additionally
 * protected by checkCsrf.
 */
export async function setSessionCookie(sid: string): Promise<void> {
  (await cookies()).set(sessionCookieName(), sid, {
    httpOnly: true,
    secure: serverEnv().production,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(sessionCookieName(), '', {
    httpOnly: true,
    secure: serverEnv().production,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** The current session with a fresh access token, or null (signed out). */
export async function currentSession(client: ClientContext): Promise<{
  sid: string;
  session: SessionData;
  manager: SessionManager;
} | null> {
  const sid = await readSessionId();
  if (!sid) return null;
  const manager = new SessionManager(await sessionStore(), (token) =>
    refreshTokens(token, client),
  );
  const session = await manager.resolve(sid);
  return session ? { sid, session, manager } : null;
}

/**
 * Starts a new session after a successful login or registration. Any session
 * id the browser already had is destroyed, so an id planted before login
 * (session fixation) is never promoted to an authenticated session.
 */
export async function startSession(
  tokens: TokenPair,
  client: ClientContext,
): Promise<Response | null> {
  const me = await backendFetch('auth/me', {
    accessToken: tokens.accessToken,
    client,
  });
  if (!me.ok) {
    return errorResponse(502, 'BAD_GATEWAY', 'Oturum başlatılamadı');
  }
  const { data } = (await me.json()) as {
    data: { id: string; tenantId: string };
  };

  const store = await sessionStore();
  const previous = await readSessionId();
  if (previous) await store.destroy(previous);
  const sid = await store.create(
    sessionFromTokens(
      tokens,
      { userId: data.id, tenantId: data.tenantId },
      Date.now(),
    ),
  );
  await setSessionCookie(sid);
  return null;
}

const UUID_CLAIM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * sub/tid of an access token the backend just returned to this server. Only
 * a fallback for identifying the session; the signature is checked by the
 * backend on every use of the token.
 */
function identityFromClaims(
  accessToken: string,
): { userId: string; tenantId: string } | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as { sub?: unknown; tid?: unknown };
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.tid !== 'string' ||
      !UUID_CLAIM.test(claims.sub) ||
      !UUID_CLAIM.test(claims.tid)
    ) {
      return null;
    }
    return { userId: claims.sub, tenantId: claims.tid };
  } catch {
    return null;
  }
}

/**
 * Replaces the current session after a store switch. The backend has already
 * revoked the old refresh token, so the old session must never stay in use:
 * the new tokens are always persisted under a new session id and the old id
 * is destroyed. The identity comes from auth/me, or from the token claims
 * when auth/me fails. The selected company is reset and the absolute timeout
 * keeps counting from the original login. When no new session can be built
 * the old one is destroyed anyway and 401 is returned.
 */
export async function switchSession(
  tokens: TokenPair,
  client: ClientContext,
): Promise<Response | null> {
  let identity: { userId: string; tenantId: string } | null = null;
  try {
    const me = await backendFetch('auth/me', {
      accessToken: tokens.accessToken,
      client,
    });
    if (me.ok) {
      const { data } = (await me.json()) as {
        data: { id: string; tenantId: string };
      };
      identity = { userId: data.id, tenantId: data.tenantId };
    }
  } catch {
    // Falls back to the token claims below.
  }
  identity ??= identityFromClaims(tokens.accessToken);

  const store = await sessionStore();
  const previousSid = await readSessionId();
  const previous = previousSid ? await store.get(previousSid) : null;
  if (!identity) {
    if (previousSid) await store.destroy(previousSid);
    await clearSessionCookie();
    return unauthenticated();
  }
  const now = Date.now();
  const sid = await store.create({
    ...sessionFromTokens(tokens, identity, now),
    createdAt: previous?.createdAt ?? now,
  });
  await setSessionCookie(sid);
  if (previousSid) await store.destroy(previousSid);
  return null;
}

/** Maps infrastructure failures to 503 so nothing internal leaks to the browser. */
export async function withSessionErrors(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof SessionUnavailableError) {
      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Servis geçici olarak kullanılamıyor',
        { 'Retry-After': String(error.retryAfter) },
      );
    }
    console.error('[bff]', error);
    return errorResponse(
      503,
      'SERVICE_UNAVAILABLE',
      'Servis geçici olarak kullanılamıyor',
      { 'Retry-After': '5' },
    );
  }
}
