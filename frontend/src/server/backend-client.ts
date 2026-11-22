import 'server-only';
import { serverEnv } from './env';
import type { RefreshResult, TokenPair } from './session-manager';

/** Who the BFF is acting for. The IP comes from server.mjs, never from client headers. */
export interface ClientContext {
  ip: string;
  userAgent: string;
}

const TIMEOUT_MS = 10_000;
/** Image uploads: decoding, re-encoding and storing take longer. */
const RAW_TIMEOUT_MS = 60_000;

/**
 * Calls the backend API. The URL is always built from BACKEND_URL plus a
 * path chosen by the BFF, so the BFF can never be pointed at another host.
 */
export async function backendFetch(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    /** Raw bytes sent instead of JSON. */
    raw?: Uint8Array<ArrayBuffer>;
    accessToken?: string;
    client: ClientContext;
    search?: URLSearchParams;
  },
): Promise<Response> {
  const { backendUrl } = serverEnv();
  const url = new URL(`/api/v1/${path}`, backendUrl);
  if (url.origin !== backendUrl.origin) throw new Error('Geçersiz backend yolu');
  if (init.search) url.search = init.search.toString();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Forwarded-For': init.client.ip,
    'User-Agent': init.client.userAgent.slice(0, 512),
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.raw) headers['Content-Type'] = 'application/octet-stream';
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;

  return fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(init.raw ? RAW_TIMEOUT_MS : TIMEOUT_MS),
  });
}

export async function refreshTokens(
  refreshToken: string,
  client: ClientContext,
): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await backendFetch('auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      client,
    });
  } catch {
    return { kind: 'unavailable' };
  }
  if (res.ok) {
    const { data } = (await res.json()) as { data: TokenPair };
    return { kind: 'ok', tokens: data };
  }
  if (res.status === 401) return { kind: 'invalid' };
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  return { kind: 'unavailable', retryAfter };
}
