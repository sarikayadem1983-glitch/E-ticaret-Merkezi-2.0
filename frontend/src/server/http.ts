import 'server-only';
import type { ClientContext } from './backend-client';
import { serverEnv } from './env';

/** Same shape as the backend: `{ error: { code, message, details } }`. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code, message, details: [] } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

export const unauthenticated = () =>
  errorResponse(401, 'UNAUTHENTICATED', 'Oturum açmanız gerekiyor');

/** Set by server.mjs from the socket and the trusted proxy list; clients cannot spoof it. */
export function clientContext(req: Request): ClientContext {
  return {
    ip: req.headers.get('x-tm-client-ip') ?? 'unknown',
    userAgent: req.headers.get('user-agent') ?? '',
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-tm-csrf';

/**
 * CSRF defence for cookie-authenticated requests, on top of SameSite=Lax:
 * 1. Origin must be exactly the app's origin (browsers always send it on POST/PATCH/DELETE).
 * 2. Sec-Fetch-Site, when sent, must be same-origin.
 * 3. A custom header must be present; cross-site forms cannot set one and
 *    cross-origin fetch would need a CORS preflight the BFF never grants.
 * Returns an error response, or null when the request may proceed.
 */
export function checkCsrf(req: Request, appOrigin = serverEnv().appOrigin) {
  if (SAFE_METHODS.has(req.method)) return null;
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (
    origin !== appOrigin ||
    (site !== null && site !== 'same-origin') ||
    req.headers.get(CSRF_HEADER) !== '1'
  ) {
    return errorResponse(403, 'CSRF_REJECTED', 'İstek reddedildi');
  }
  return null;
}

const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON object body of at most 64 KB; anything else is rejected. */
export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) {
    return {
      ok: false,
      response: errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON bekleniyor'),
    };
  }
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(
        413,
        'PAYLOAD_TOO_LARGE',
        'İstek gövdesi izin verilen boyutu aşıyor',
      ),
    };
  }
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, 'BAD_REQUEST', 'İstek gövdesi geçerli JSON değil'),
    };
  }
}

/** Relays a backend response: status, JSON body and Retry-After only. */
export async function relay(res: Response): Promise<Response> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) headers['Retry-After'] = retryAfter;
  if (res.status === 204) return new Response(null, { status: 204, headers });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
