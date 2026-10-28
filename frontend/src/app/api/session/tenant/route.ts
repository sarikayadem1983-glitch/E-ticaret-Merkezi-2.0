import { backendFetch } from '@/server/backend-client';
import {
  checkCsrf,
  clientContext,
  errorResponse,
  readJsonBody,
  relay,
  unauthenticated,
} from '@/server/http';
import {
  currentSession,
  sessionStore,
  switchSession,
  withSessionErrors,
} from '@/server/session';
import type { TokenPair } from '@/server/session-manager';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCK_TTL_MS = 10_000;

/**
 * Switches the session to another store. The backend checks the membership
 * and swaps the refresh token; on success the browser gets a new session id
 * (the old one is destroyed). On any failure (404 no active membership, 401)
 * the current session is left untouched.
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

    // Same lock as token refresh: the refresh token must not be rotated by
    // a parallel request while the backend swaps it.
    const store = await sessionStore();
    const owner = await store.lock(current.sid, LOCK_TTL_MS);
    if (!owner) {
      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Oturum yenileniyor, tekrar deneyin',
        {
          'Retry-After': '1',
        },
      );
    }
    try {
      const session = await store.get(current.sid);
      if (!session) return unauthenticated();
      const res = await backendFetch('auth/switch-tenant', {
        method: 'POST',
        body: { tenantId, refreshToken: session.refreshToken },
        accessToken: session.accessToken,
        client,
      });
      if (!res.ok) return relay(res);

      const { data } = (await res.json()) as { data: TokenPair };
      const failed = await switchSession(data, client);
      return (
        failed ??
        new Response(null, {
          status: 204,
          headers: { 'Cache-Control': 'no-store' },
        })
      );
    } finally {
      await store.unlock(current.sid, owner);
    }
  });
}
