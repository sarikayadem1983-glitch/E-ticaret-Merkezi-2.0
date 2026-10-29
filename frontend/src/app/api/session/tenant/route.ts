import { type ClientContext, backendFetch } from '@/server/backend-client';
import {
  checkCsrf,
  clientContext,
  errorResponse,
  readJsonBody,
  relay,
  unauthenticated,
} from '@/server/http';
import {
  clearSessionCookie,
  currentSession,
  sessionStore,
  switchSession,
  withSessionErrors,
} from '@/server/session';
import { type TokenPair, errorCode } from '@/server/session-manager';
import type { SessionData, SessionStore } from '@/server/session-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCK_TTL_MS = 10_000;

/**
 * Switches the session to another store. The backend checks the membership
 * and swaps the refresh token; on success the browser gets a new session id
 * (the old one is destroyed). On 404 (no active membership) or another error
 * the current session is left untouched. 401 TOKEN_STALE: one refresh and one
 * retry; SESSION_REVOKED or a second TOKEN_STALE destroys the session. If the
 * new session cannot be stored the switch is undone and the answer is 503.
 */
export async function POST(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { tenantId } = (parsed.body ?? {}) as { tenantId?: unknown };
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      return errorResponse(422, 'VALIDATION_ERROR', 'Geçersiz mağaza');
    }

    const client = clientContext(req);
    const current = await currentSession(client);
    if (!current) return unauthenticated();

    const store = await sessionStore();
    const first = await switchOnce(store, current.sid, tenantId, client);
    if (first.kind !== 'stale') return first.response;

    // TOKEN_STALE (role or store changed): refresh once outside the switch
    // lock (forceRefresh takes the same lock), then retry the switch once.
    const refreshed = await current.manager.forceRefresh(
      current.sid,
      first.session,
    );
    if (!refreshed) return revoke(store, current.sid);
    const retry = await switchOnce(store, current.sid, tenantId, client);
    if (retry.kind === 'stale') return revoke(store, current.sid);
    return retry.response;
  });
}

type Attempt =
  | { kind: 'done'; response: Response }
  /** Backend answered 401 TOKEN_STALE for this session state. */
  | { kind: 'stale'; session: SessionData };

/**
 * One switch-tenant call under the session lock (same lock as token refresh:
 * the refresh token must not be rotated by a parallel request while the
 * backend swaps it). SESSION_REVOKED destroys the session.
 */
async function switchOnce(
  store: SessionStore,
  sid: string,
  tenantId: string,
  client: ClientContext,
): Promise<Attempt> {
  const owner = await store.lock(sid, LOCK_TTL_MS);
  if (!owner) {
    return {
      kind: 'done',
      response: errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Oturum yenileniyor, tekrar deneyin',
        { 'Retry-After': '1' },
      ),
    };
  }
  try {
    const session = await store.get(sid);
    if (!session) return { kind: 'done', response: unauthenticated() };
    const res = await backendFetch('auth/switch-tenant', {
      method: 'POST',
      body: { tenantId, refreshToken: session.refreshToken },
      accessToken: session.accessToken,
      client,
    });
    if (res.status === 401) {
      const code = await errorCode(res);
      if (code === 'TOKEN_STALE') return { kind: 'stale', session };
      if (code === 'SESSION_REVOKED') {
        return { kind: 'done', response: await revoke(store, sid) };
      }
    }
    if (!res.ok) return { kind: 'done', response: await relay(res) };

    const { data } = (await res.json()) as { data: TokenPair };
    let failed: Response | null;
    try {
      failed = await switchSession(data, client);
    } catch (error) {
      // The backend already swapped the refresh token but the new session was
      // not stored (INF-18). Undo the swap so the old session keeps working
      // instead of raising the reuse alarm on its next refresh.
      if (
        !(await abortSwitch(data.refreshToken, session.refreshToken, client))
      ) {
        // Not undone: the old session holds a revoked token whose next refresh
        // would raise the reuse alarm. Drop the cookie (no Redis needed) so
        // the user signs in again instead.
        await clearSessionCookie().catch(() => {});
      }
      throw error;
    }
    return {
      kind: 'done',
      response:
        failed ??
        new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        }),
    };
  } finally {
    await store.unlock(sid, owner);
  }
}

/** Never throws: the caller answers 503 either way. True when undone. */
async function abortSwitch(
  refreshToken: string,
  previousRefreshToken: string,
  client: ClientContext,
): Promise<boolean> {
  try {
    const res = await backendFetch('auth/switch-tenant/abort', {
      method: 'POST',
      body: { refreshToken, previousRefreshToken },
      client,
    });
    if (res.ok) return true;
    console.error(`[bff] mağaza değişikliği geri alınamadı: ${res.status}`);
  } catch (error) {
    console.error('[bff] mağaza değişikliği geri alınamadı:', error);
  }
  return false;
}

async function revoke(store: SessionStore, sid: string): Promise<Response> {
  await store.destroy(sid);
  await clearSessionCookie();
  return unauthenticated();
}
