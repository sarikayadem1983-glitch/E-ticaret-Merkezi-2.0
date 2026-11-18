import { backendFetch } from '@/server/backend-client';
import { checkCsrf, clientContext, readJsonBody, relay } from '@/server/http';
import { withSessionErrors } from '@/server/session';

const FIELDS = [
  'tenantName',
  'tenantSlug',
  'name',
  'email',
  'password',
] as const;

/**
 * Asks the backend to create a store and its owner (INF-20). The answer is the
 * same for a new or a taken address and starts no session: the user reads the
 * e-mail and then signs in. The backend validates every field.
 */
export async function POST(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const input = (parsed.body ?? {}) as Record<string, unknown>;
    const body = Object.fromEntries(FIELDS.map((f) => [f, input[f]]));

    const res = await backendFetch('auth/register', {
      method: 'POST',
      body,
      client: clientContext(req),
    });
    if (!res.ok) return relay(res);
    return Response.json(
      { data: { status: 'check-email' } },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
