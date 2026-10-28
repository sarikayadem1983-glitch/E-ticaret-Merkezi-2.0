import { backendFetch } from '@/server/backend-client';
import { checkCsrf, clientContext } from '@/server/http';
import {
  clearSessionCookie,
  currentSession,
  readSessionId,
  sessionStore,
  withSessionErrors,
} from '@/server/session';

/**
 * Revokes the refresh token in the backend, deletes the server-side session
 * and clears the cookie. Local cleanup happens even if the backend call fails.
 */
export async function POST(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const client = clientContext(req);
    const sid = await readSessionId();
    if (sid) {
      const current = await currentSession(client).catch(() => null);
      if (current) {
        await backendFetch('auth/logout', {
          method: 'POST',
          body: { refreshToken: current.session.refreshToken },
          accessToken: current.session.accessToken,
          client,
        }).catch(() => undefined);
      }
      await (await sessionStore()).destroy(sid);
    }
    await clearSessionCookie();
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  });
}
