import 'server-only';
import { backendFetch } from './backend-client';
import { checkCsrf, clientContext, errorResponse, readJsonBody, relay } from './http';

/**
 * Session-less endpoints: invitations (lookup, accept) and account recovery
 * (password forgot/reset, e-mail verify, USR-19): the caller usually has
 * no session. CSRF is checked like every state-changing request; only the
 * listed fields reach the backend, which validates them and rate-limits by
 * the client IP (X-Forwarded-For from server.mjs). No session is read or
 * started: accept returns no tokens and the user signs in afterwards.
 */
export async function forwardInvitation(
  req: Request,
  path:
    | 'invitations/lookup'
    | 'invitations/accept'
    | 'auth/password/forgot'
    | 'auth/password/reset'
    | 'auth/email/verify',
  fields: readonly string[],
): Promise<Response> {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  if (
    typeof parsed.body !== 'object' ||
    parsed.body === null ||
    Array.isArray(parsed.body)
  ) {
    return errorResponse(400, 'BAD_REQUEST', 'İstek gövdesi bir nesne olmalı');
  }
  const input = parsed.body as Record<string, unknown>;
  const body = Object.fromEntries(
    fields.filter((f) => f in input).map((f) => [f, input[f]]),
  );
  const res = await backendFetch(path, {
    method: 'POST',
    body,
    client: clientContext(req),
  });
  return relay(res);
}
