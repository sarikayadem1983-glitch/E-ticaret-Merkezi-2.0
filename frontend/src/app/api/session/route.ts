import { backendFetch } from '@/server/backend-client';
import { clientContext, relay, unauthenticated } from '@/server/http';
import {
  clearSessionCookie,
  currentSession,
  withSessionErrors,
} from '@/server/session';

/** The signed-in user's profile and selected company. Never returns tokens. */
export async function GET(req: Request) {
  return withSessionErrors(async () => {
    const client = clientContext(req);
    const current = await currentSession(client);
    if (!current) {
      await clearSessionCookie();
      return unauthenticated();
    }
    const res = await backendFetch('auth/me', {
      accessToken: current.session.accessToken,
      client,
    });
    if (!res.ok) return relay(res);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    return Response.json(
      {
        data: {
          user: data,
          selectedCompanyId: current.session.selectedCompanyId,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
