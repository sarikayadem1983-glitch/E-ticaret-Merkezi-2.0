import { hardNavigate } from './navigation';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Sent on every request; the BFF refuses state-changing requests without it (CSRF). */
const CSRF_HEADERS = { 'x-tm-csrf': '1' };

async function toError(res: Response): Promise<ApiError> {
  const retryAfter = Number(res.headers.get('retry-after')) || undefined;
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
    };
    return new ApiError(
      res.status,
      body.error?.code ?? 'ERROR',
      body.error?.message ?? 'Beklenmeyen bir hata oluştu',
      body.error?.details ?? [],
      retryAfter,
    );
  } catch {
    return new ApiError(res.status, 'ERROR', 'Beklenmeyen bir hata oluştu');
  }
}

/**
 * Same-origin request to the Next.js BFF. The session cookie is sent by the
 * browser; no token ever passes through JavaScript.
 */
export async function request<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...CSRF_HEADERS,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    const onAuthPage = ['/login', '/register'].includes(window.location.pathname);
    // Session-less invitation calls answer 401 for a wrong password, not for a lost session.
    const sessionless = url.startsWith('/api/auth/') || url.startsWith('/api/invitations/');
    if (!onAuthPage && !sessionless) {
      hardNavigate(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Backend API through the BFF allowlist, e.g. bff('companies/summary'). */
export function bff<T>(path: string, init?: { method?: string; body?: unknown }) {
  return request<T>(`/api/bff/${path}`, init);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429 && error.retryAfter) {
      return `${error.message} (${error.retryAfter} sn sonra)`;
    }
    return error.message;
  }
  return 'Beklenmeyen bir hata oluştu';
}
