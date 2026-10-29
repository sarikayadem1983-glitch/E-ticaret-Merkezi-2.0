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
  clearSessionCookie,
  currentSession,
  sessionStore,
  withSessionErrors,
} from '@/server/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stores the company picked in the company selector, after the backend confirms access to it. */
export async function PUT(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { companyId } = (parsed.body ?? {}) as { companyId?: unknown };
    if (
      companyId !== null &&
      (typeof companyId !== 'string' || !UUID.test(companyId))
    ) {
      return errorResponse(422, 'VALIDATION_ERROR', 'Geçersiz firma');
    }

    const client = clientContext(req);
    const current = await currentSession(client);
    if (!current) return unauthenticated();

    if (companyId) {
      const result = await current.manager.send(
        current.sid,
        current.session,
        (accessToken) =>
          backendFetch(`companies/${companyId}`, { accessToken, client }),
      );
      if (result.kind === 'signed-out') {
        await clearSessionCookie();
        return unauthenticated();
      }
      if (!result.response.ok) return relay(result.response);
    }
    // Re-read: a TOKEN_STALE retry may have rotated the tokens meanwhile.
    const store = await sessionStore();
    const latest = await store.get(current.sid);
    if (!latest) return unauthenticated();
    await store.save(current.sid, { ...latest, selectedCompanyId: companyId });
    return Response.json(
      { data: { selectedCompanyId: companyId } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
