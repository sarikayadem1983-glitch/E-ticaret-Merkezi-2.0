/**
 * The only backend calls the browser may make through /api/bff. Anything not
 * listed is refused, so the BFF cannot be used as an open proxy to other
 * backend endpoints, other hosts or arbitrary paths.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface BffRoute {
  method: 'GET' | 'POST' | 'PATCH';
  path: RegExp;
  /** Allowed query parameters (GET only). */
  query?: readonly string[];
  /** Whether a JSON body is forwarded. */
  body?: boolean;
}

const ROUTES: readonly BffRoute[] = [
  {
    method: 'GET',
    path: /^companies$/,
    query: ['page', 'per_page', 'search', 'status'],
  },
  { method: 'GET', path: /^companies\/summary$/ },
  { method: 'GET', path: new RegExp(`^companies/${UUID}$`) },
  { method: 'POST', path: /^companies$/, body: true },
  { method: 'PATCH', path: new RegExp(`^companies/${UUID}$`), body: true },
  { method: 'POST', path: new RegExp(`^companies/${UUID}/(de)?activate$`) },
  { method: 'GET', path: /^auth\/me$/ },
];

const SEGMENT = /^[a-z0-9-]{1,64}$/;
const MAX_QUERY_VALUE = 100;

export type BffMatch =
  | { ok: true; path: string; search: URLSearchParams; body: boolean }
  | { ok: false; status: 404 | 400 };

export function matchBffRoute(
  method: string,
  segments: string[],
  query: URLSearchParams,
): BffMatch {
  // Segments arrive decoded; anything outside [a-z0-9-] (dots, slashes, %, spaces) is refused.
  if (segments.length === 0 || !segments.every((s) => SEGMENT.test(s))) {
    return { ok: false, status: 404 };
  }
  const path = segments.join('/');
  const route = ROUTES.find((r) => r.method === method && r.path.test(path));
  if (!route) return { ok: false, status: 404 };

  const search = new URLSearchParams();
  for (const [key, value] of query) {
    if (!route.query?.includes(key) || value.length > MAX_QUERY_VALUE) {
      return { ok: false, status: 400 };
    }
    search.set(key, value);
  }
  return { ok: true, path, search, body: route.body ?? false };
}
