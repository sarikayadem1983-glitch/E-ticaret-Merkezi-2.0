import { backendFetch } from '@/server/backend-client';
import { checkCsrf, clientContext, readJsonBody, relay } from '@/server/http';
import type { TokenPair } from '@/server/session-manager';
import { readyRedis } from '@/server/redis';
import { startSession, withSessionErrors } from '@/server/session';

const FIELDS = [
  'tenantName',
  'tenantSlug',
  'name',
  'email',
  'password',
] as const;

/** Creates a store and its owner, then signs in. The backend validates every field. */
export async function POST(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const input = (parsed.body ?? {}) as Record<string, unknown>;
    const body = Object.fromEntries(FIELDS.map((f) => [f, input[f]]));

    // Fail before the backend call if sessions cannot be stored.
    await readyRedis();
    const client = clientContext(req);
    const res = await backendFetch('auth/register', {
      method: 'POST',
      body,
      client,
    });
    if (!res.ok) return relay(res);

    const { data } = (await res.json()) as { data: TokenPair };
    const failed = await startSession(data, client);
    return (
      failed ??
      Response.json(
        { data: { ok: true } },
        { status: 201, headers: { 'Cache-Control': 'no-store' } },
      )
    );
  });
}
