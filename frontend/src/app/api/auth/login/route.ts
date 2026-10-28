import { backendFetch } from '@/server/backend-client';
import {
  checkCsrf,
  clientContext,
  errorResponse,
  readJsonBody,
  relay,
} from '@/server/http';
import type { TokenPair } from '@/server/session-manager';
import { readyRedis } from '@/server/redis';
import { startSession, withSessionErrors } from '@/server/session';

const isString = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/** Signs in through the backend and keeps the tokens server-side; the browser only gets a session cookie. */
export async function POST(req: Request) {
  return withSessionErrors(async () => {
    const csrf = checkCsrf(req);
    if (csrf) return csrf;
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const { email, password } = (parsed.body ?? {}) as Record<string, unknown>;
    if (!isString(email, 254) || !isString(password, 128)) {
      return errorResponse(422, 'VALIDATION_ERROR', 'Email ve şifre gerekli');
    }

    // Fail before the backend call if sessions cannot be stored.
    await readyRedis();
    const client = clientContext(req);
    const res = await backendFetch('auth/login', {
      method: 'POST',
      body: { email, password },
      client,
    });
    if (!res.ok) return relay(res);

    const { data } = (await res.json()) as { data: TokenPair };
    const failed = await startSession(data, client);
    return (
      failed ??
      Response.json(
        { data: { ok: true } },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    );
  });
}
