import { backendFetch } from '@/server/backend-client';
import { matchBffRoute } from '@/server/bff-routes';
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
  withSessionErrors,
} from '@/server/session';

type Context = { params: Promise<{ path: string[] }> };

/**
 * Authenticated pass-through to an allowlisted backend endpoint. Only the
 * JSON body is forwarded; cookies and client headers never reach the backend.
 * The backend still checks the JWT, permissions and tenant on every call.
 */
async function handle(req: Request, { params }: Context): Promise<Response> {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;

    const route = matchBffRoute(
      req.method,
      (await params).path,
      new URL(req.url).searchParams,
    );
    if (!route.ok) {
      return route.status === 404
        ? errorResponse(404, 'NOT_FOUND', 'Bulunamadı')
        : errorResponse(400, 'BAD_REQUEST', 'Geçersiz sorgu');
    }

    let body: unknown;
    if (route.body) {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.response;
      body = parsed.body;
    }

    const client = clientContext(req);
    const current = await currentSession(client);
    if (!current) {
      await clearSessionCookie();
      return unauthenticated();
    }

    // TOKEN_STALE: one refresh + one retry. SESSION_REVOKED or a second 401:
    // the session is destroyed (membership or store deactivated).
    const result = await current.manager.send(
      current.sid,
      current.session,
      (accessToken) =>
        backendFetch(route.path, {
          method: req.method,
          body,
          accessToken,
          client,
          search: route.search,
        }),
    );
    if (result.kind === 'signed-out') {
      await clearSessionCookie();
      return unauthenticated();
    }
    return relay(result.response);
  });
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT };
