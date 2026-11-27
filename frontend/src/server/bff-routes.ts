/**
 * The only backend calls the browser may make through /api/bff. Anything not
 * listed is refused, so the BFF cannot be used as an open proxy to other
 * backend endpoints, other hosts or arbitrary paths.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

interface BffRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: RegExp;
  /** Allowed query parameters. */
  query?: readonly string[];
  /** Whether a JSON body is forwarded. */
  body?: boolean;
  /** Whether raw bytes are forwarded instead (image upload only). */
  raw?: boolean;
}

const CHANNEL = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PRODUCT = `products/${UUID}`;
const VARIANT = `${PRODUCT}/variants/${UUID}`;
const LIST_QUERY = ['page', 'per_page', 'search'] as const;
const ACCOUNTS = `companies/${UUID}/channel-accounts`;
const ACCOUNT = `${ACCOUNTS}/${UUID}`;

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
  { method: 'GET', path: /^auth\/memberships$/ },
  // USR-19: ask for a new verification e-mail (no body; the backend uses the session user).
  { method: 'POST', path: /^auth\/email\/verification$/ },
  // User management (USR-T11a/T12a). Session-less invitation lookup/accept
  // have their own routes under /api/invitations and are not proxied here.
  { method: 'GET', path: /^users$/ },
  { method: 'PUT', path: new RegExp(`^users/${UUID}/access$`), body: true },
  { method: 'POST', path: new RegExp(`^users/${UUID}/(de)?activate$`) },
  // USR-T12b: status filter and resend (new token, rate limited by the backend).
  { method: 'GET', path: /^invitations$/, query: ['status'] },
  { method: 'POST', path: /^invitations$/, body: true },
  { method: 'POST', path: new RegExp(`^invitations/${UUID}/(revoke|resend)$`) },
  // USR-T12b: accept while signed in as the invited account (session required).
  { method: 'POST', path: /^invitations\/accept-as-current$/, body: true },
  // Catalog (CAT-04). Category/brand writes are not exposed yet.
  {
    method: 'GET',
    path: /^products$/,
    query: [...LIST_QUERY, 'status', 'company_id', 'category_id', 'brand_id'],
  },
  { method: 'POST', path: /^products$/, body: true },
  { method: 'GET', path: new RegExp(`^${PRODUCT}$`) },
  { method: 'PATCH', path: new RegExp(`^${PRODUCT}$`), body: true },
  { method: 'DELETE', path: new RegExp(`^${PRODUCT}$`) },
  { method: 'POST', path: new RegExp(`^${PRODUCT}/variants$`), body: true },
  {
    method: 'POST',
    path: new RegExp(`^${PRODUCT}/variants/generate$`),
    body: true,
  },
  { method: 'PATCH', path: new RegExp(`^${VARIANT}$`), body: true },
  { method: 'DELETE', path: new RegExp(`^${VARIANT}$`) },
  {
    method: 'PUT',
    path: new RegExp(`^${VARIANT}/prices/${CHANNEL}$`),
    body: true,
  },
  { method: 'DELETE', path: new RegExp(`^${VARIANT}/prices/${CHANNEL}$`) },
  // RPT-02: private purchase cost (products:write only; never in general product responses).
  { method: 'GET', path: new RegExp(`^${VARIANT}/cost$`) },
  { method: 'PUT', path: new RegExp(`^${VARIANT}/cost$`), body: true },
  // Images (IMG-01). The upload forwards raw bytes; everything else is JSON.
  { method: 'GET', path: new RegExp(`^${PRODUCT}/images$`) },
  {
    method: 'POST',
    path: new RegExp(`^${PRODUCT}/images$`),
    query: ['variant_id'],
    raw: true,
  },
  { method: 'PUT', path: new RegExp(`^${PRODUCT}/images/order$`), body: true },
  { method: 'PATCH', path: new RegExp(`^${PRODUCT}/images/${UUID}$`), body: true },
  { method: 'DELETE', path: new RegExp(`^${PRODUCT}/images/${UUID}$`) },
  { method: 'GET', path: /^(categories|brands|attributes)$/, query: LIST_QUERY },
  { method: 'POST', path: /^attributes$/, body: true },
  { method: 'POST', path: new RegExp(`^attributes/${UUID}/values$`), body: true },
  // INT-03 integrations: credentials go in (POST/PATCH body), never come out (masked).
  { method: 'GET', path: /^channel-definitions$/ },
  { method: 'GET', path: new RegExp(`^${ACCOUNTS}$`) },
  { method: 'POST', path: new RegExp(`^${ACCOUNTS}$`), body: true },
  { method: 'PATCH', path: new RegExp(`^${ACCOUNT}$`), body: true },
  { method: 'DELETE', path: new RegExp(`^${ACCOUNT}$`) },
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/test-connection$`) },
  {
    method: 'GET',
    path: new RegExp(`^${ACCOUNT}/sync-jobs$`),
    query: ['status', 'limit', 'cursor'],
  },
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/sync-jobs/${UUID}/retry$`) },
  // INT-TY-01a: read-only product pull (nothing is written to Trendyol).
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/trendyol/products-pull$`) },
  // Same, plus draft local products for unmatched ones (still read-only towards Trendyol).
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/trendyol/products-import$`) },
  // INT-TY-02a: Trendyol stock + price into the app (read-only towards Trendyol).
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/trendyol/stock-price-pull$`) },
  // INT-TY-02b: WRITES local stock + price of selected variants to Trendyol (manual).
  { method: 'POST', path: new RegExp(`^${ACCOUNT}/trendyol/stock-price-push$`), body: true },
  // Orders (ORD-03). Status changes of marketplace orders are refused by the backend.
  {
    method: 'GET',
    path: /^orders$/,
    query: [...LIST_QUERY, 'status', 'company_id', 'channel'],
  },
  { method: 'GET', path: new RegExp(`^orders/${UUID}$`) },
  { method: 'POST', path: /^orders$/, body: true },
  { method: 'POST', path: new RegExp(`^orders/${UUID}/status$`), body: true },
  // Stock (INV-02/03).
  { method: 'GET', path: /^warehouses$/, query: ['company_id'] },
  { method: 'POST', path: /^warehouses$/, body: true },
  {
    method: 'GET',
    path: /^stock-levels$/,
    query: ['page', 'per_page', 'company_id', 'warehouse_id', 'variant_id'],
  },
  { method: 'GET', path: /^stock-levels\/low$/, query: ['company_id'] },
  { method: 'POST', path: /^stock-movements$/, body: true },
  { method: 'POST', path: /^stock-(transfers|counts)$/, body: true },
  { method: 'PUT', path: new RegExp(`^stock-thresholds/${UUID}$`), body: true },
  { method: 'POST', path: new RegExp(`^orders/${UUID}/reserve$`), body: true },
  // Exports (IMP-04): CSV text inside a JSON body.
  { method: 'GET', path: /^exports\/(products|stock)$/, query: ['company_id'] },
  // Product import (IMP-01): CSV text in the JSON body; dry run by default.
  { method: 'POST', path: /^imports\/products$/, body: true },
  // Dashboard KPIs (DSH-02).
  { method: 'GET', path: /^dashboard\/kpis$/, query: ['company_id'] },
  // Reports (RPT-01): read-only.
  {
    method: 'GET',
    path: /^reports\/sales$/,
    query: ['from', 'to', 'group_by', 'company_id', 'channel'],
  },
  // RPT-02: stock value/turnover/out-of-stock (costs only where products:write).
  { method: 'GET', path: /^reports\/stock$/, query: ['days', 'company_id'] },
];

const SEGMENT = /^[a-z0-9-]{1,64}$/;
const MAX_QUERY_VALUE = 100;

export type BffMatch =
  | { ok: true; path: string; search: URLSearchParams; body: boolean; raw: boolean }
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
  return { ok: true, path, search, body: route.body ?? false, raw: route.raw ?? false };
}
