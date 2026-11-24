import { matchBffRoute } from './bff-routes';

const ID = '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f';
const q = (s = '') => new URLSearchParams(s);
const match = (method: string, path: string, query = '') =>
  matchBffRoute(method, path.split('/'), q(query));

describe('matchBffRoute', () => {
  it.each([
    ['GET', 'companies', 'page=2&per_page=20&search=abc&status=active'],
    ['GET', 'companies/summary', ''],
    ['GET', `companies/${ID}`, ''],
    ['POST', 'companies', ''],
    ['PATCH', `companies/${ID}`, ''],
    ['POST', `companies/${ID}/deactivate`, ''],
    ['POST', `companies/${ID}/activate`, ''],
    ['GET', 'auth/me', ''],
    ['GET', 'auth/memberships', ''],
    ['GET', 'users', ''],
    ['PUT', `users/${ID}/access`, ''],
    ['POST', `users/${ID}/deactivate`, ''],
    ['POST', `users/${ID}/activate`, ''],
    ['GET', 'invitations', ''],
    ['GET', 'invitations', 'status=revoked'],
    ['POST', 'invitations', ''],
    ['POST', `invitations/${ID}/revoke`, ''],
    ['POST', `invitations/${ID}/resend`, ''],
    ['POST', 'invitations/accept-as-current', ''],
    ['GET', 'products', 'page=1&per_page=20&search=x&status=active&company_id=a&category_id=b&brand_id=c'],
    ['POST', 'products', ''],
    ['GET', `products/${ID}`, ''],
    ['PATCH', `products/${ID}`, ''],
    ['DELETE', `products/${ID}`, ''],
    ['POST', `products/${ID}/variants`, ''],
    ['POST', `products/${ID}/variants/generate`, ''],
    ['PATCH', `products/${ID}/variants/${ID}`, ''],
    ['DELETE', `products/${ID}/variants/${ID}`, ''],
    ['PUT', `products/${ID}/variants/${ID}/prices/list`, ''],
    ['PUT', `products/${ID}/variants/${ID}/prices/hepsi-burada`, ''],
    ['DELETE', `products/${ID}/variants/${ID}/prices/trendyol`, ''],
    ['GET', `products/${ID}/images`, ''],
    ['POST', `products/${ID}/images`, `variant_id=${ID}`],
    ['PUT', `products/${ID}/images/order`, ''],
    ['PATCH', `products/${ID}/images/${ID}`, ''],
    ['DELETE', `products/${ID}/images/${ID}`, ''],
    ['GET', 'categories', 'search=a'],
    ['GET', 'brands', 'page=2'],
    ['GET', 'attributes', 'per_page=100'],
    ['POST', 'attributes', ''],
    ['POST', `attributes/${ID}/values`, ''],
  ])('allows %s %s', (method, path, query) => {
    expect(match(method, path, query)).toMatchObject({ ok: true, path });
  });

  it('forwards a body only where the route takes one', () => {
    expect(match('POST', 'companies')).toMatchObject({ body: true, raw: false });
    expect(match('POST', `products/${ID}/images`)).toMatchObject({ body: false, raw: true });
    expect(match('POST', `companies/${ID}/deactivate`)).toMatchObject({ body: false });
    expect(match('PUT', `users/${ID}/access`)).toMatchObject({ body: true });
    expect(match('POST', 'invitations')).toMatchObject({ body: true });
    expect(match('POST', `users/${ID}/deactivate`)).toMatchObject({ body: false });
    expect(match('POST', `invitations/${ID}/revoke`)).toMatchObject({ body: false });
  });

  it.each([
    // Session-less invitation endpoints have their own routes (/api/invitations/*).
    ['lookup through the session proxy', 'POST', 'invitations/lookup'],
    ['accept through the session proxy', 'POST', 'invitations/accept'],
    ['user detail (USR-T11b)', 'GET', `users/${ID}`],
    ['PUT without a body route', 'PUT', `users/${ID}`],
    ['PUT on companies', 'PUT', `companies/${ID}`],
    ['PATCH on access', 'PATCH', `users/${ID}/access`],
    ['GET on access', 'GET', `users/${ID}/access`],
    ['DELETE on users', 'DELETE', `users/${ID}`],
    ['non-uuid user', 'PUT', 'users/me/access'],
  ])('refuses %s: %s %s', (_name, method, path) => {
    expect(match(method, path)).toEqual({ ok: false, status: 404 });
  });

  it('accepts no query on the user management routes yet', () => {
    expect(match('GET', 'users', 'page=1')).toEqual({ ok: false, status: 400 });
    expect(match('GET', 'invitations', 'page=1')).toEqual({ ok: false, status: 400 });
  });

  it.each([
    ['endpoint not exposed', 'GET', 'audit-logs'],
    ['auth endpoint', 'POST', 'auth/refresh'],
    ['auth endpoint', 'POST', 'auth/logout'],
    ['auth endpoint', 'POST', 'auth/switch-tenant'],
    ['wrong method', 'POST', 'auth/memberships'],
    ['health', 'GET', 'health'],
    ['wrong method', 'DELETE', `companies/${ID}`],
    ['category write (not exposed)', 'POST', 'categories'],
    ['brand delete (not exposed)', 'DELETE', `brands/${ID}`],
    ['attribute delete (not exposed)', 'DELETE', `attributes/${ID}`],
    ['price channel with a leading dash', 'PUT', `products/${ID}/variants/${ID}/prices/-list`],
    ['price without channel', 'PUT', `products/${ID}/variants/${ID}/prices`],
    ['DELETE on products list', 'DELETE', 'products'],
    ['wrong method', 'PUT', 'companies'],
    ['non-uuid id', 'GET', 'companies/123'],
    ['uppercase uuid', 'GET', `companies/${ID.toUpperCase()}`],
    ['extra segment', 'GET', `companies/${ID}/extra`],
  ])('refuses %s: %s %s', (_name, method, path) => {
    expect(match(method, path)).toEqual({ ok: false, status: 404 });
  });

  it.each([
    ['dot segments', ['companies', '..', 'audit-logs']],
    ['decoded slash', ['companies', '../audit-logs']],
    ['absolute URL', ['http:', '', 'evil.example']],
    ['backslash', ['companies\\..\\audit-logs']],
    ['percent', ['companies%2F..']],
    ['empty', []],
  ])('refuses path tricks (%s)', (_name, segments) => {
    expect(matchBffRoute('GET', segments, q())).toEqual({ ok: false, status: 404 });
  });

  it('forwards bodies on catalog writes, never on DELETE', () => {
    expect(match('POST', 'products')).toMatchObject({ body: true });
    expect(match('PUT', `products/${ID}/variants/${ID}/prices/list`)).toMatchObject({ body: true });
    expect(match('DELETE', `products/${ID}`)).toMatchObject({ body: false });
    expect(match('GET', 'products', 'tenant_id=x')).toEqual({ ok: false, status: 400 });
  });

  it('refuses unknown or oversized query parameters', () => {
    expect(match('GET', 'companies', 'tenantId=x')).toEqual({ ok: false, status: 400 });
    expect(match('GET', 'companies', `search=${'a'.repeat(101)}`)).toEqual({
      ok: false,
      status: 400,
    });
    expect(match('GET', 'companies/summary', 'page=1')).toEqual({ ok: false, status: 400 });
  });

  it('allows the integration routes and nothing around them (INT-03)', () => {
    const acc = `companies/${ID}/channel-accounts`;
    const allowed: [string, string, string][] = [
      ['GET', 'channel-definitions', ''],
      ['GET', acc, ''],
      ['POST', acc, ''],
      ['PATCH', `${acc}/${ID}`, ''],
      ['DELETE', `${acc}/${ID}`, ''],
      ['POST', `${acc}/${ID}/test-connection`, ''],
      ['GET', `${acc}/${ID}/sync-jobs`, 'status=failed&limit=20&cursor=x'],
      ['POST', `${acc}/${ID}/sync-jobs/${ID}/retry`, ''],
      ['POST', `${acc}/${ID}/trendyol/products-pull`, ''],
      ['POST', `${acc}/${ID}/trendyol/products-import`, ''],
      ['POST', `${acc}/${ID}/trendyol/stock-price-pull`, ''],
    ];
    for (const [method, path, query] of allowed) {
      expect(match(method, path, query).ok).toBe(true);
    }
    expect(match('POST', acc)).toMatchObject({ ok: true, body: true });
    expect(match('DELETE', `${acc}/${ID}`)).toMatchObject({ ok: true, body: false });
    expect(match('GET', `${acc}/${ID}`)).toEqual({ ok: false, status: 404 });
    expect(match('PUT', `${acc}/${ID}`)).toEqual({ ok: false, status: 404 });
    expect(match('GET', `${acc}/${ID}/test-connection`)).toEqual({ ok: false, status: 404 });
    expect(match('GET', `${acc}/${ID}/sync-jobs`, 'tenant=x')).toEqual({
      ok: false,
      status: 400,
    });
    expect(match('POST', `${acc}/${ID}/sync-jobs`)).toEqual({ ok: false, status: 404 });
  });

  it('allows the stock routes and nothing around them (INV-03)', () => {
    expect(match('GET', 'warehouses', 'company_id=x')).toMatchObject({ ok: true });
    expect(match('POST', 'warehouses')).toMatchObject({ ok: true, body: true });
    expect(match('GET', 'stock-levels', 'page=1&per_page=50&warehouse_id=x')).toMatchObject({ ok: true });
    expect(match('GET', 'stock-levels/low', 'company_id=x')).toMatchObject({ ok: true });
    expect(match('POST', 'stock-movements')).toMatchObject({ ok: true, body: true });
    expect(match('POST', 'stock-transfers')).toMatchObject({ ok: true, body: true });
    expect(match('POST', 'stock-counts')).toMatchObject({ ok: true, body: true });
    expect(match('GET', 'stock-transfers')).toEqual({ ok: false, status: 404 });
    expect(match('PUT', `stock-thresholds/${ID}`)).toMatchObject({ ok: true, body: true });
    expect(match('POST', `orders/${ID}/reserve`)).toMatchObject({ ok: true, body: true });
    expect(match('DELETE', `stock-thresholds/${ID}`)).toEqual({ ok: false, status: 404 });
    expect(match('GET', 'stock-movements')).toEqual({ ok: false, status: 404 });
    expect(match('PATCH', 'warehouses')).toEqual({ ok: false, status: 404 });
    expect(match('GET', 'stock-levels', 'tenant_id=x')).toEqual({ ok: false, status: 400 });
  });

  it('allows the two exports read-only (IMP-04)', () => {
    expect(match('GET', 'exports/products', 'company_id=x')).toMatchObject({ ok: true, body: false });
    expect(match('GET', 'exports/stock')).toMatchObject({ ok: true });
    expect(match('GET', 'exports/users')).toEqual({ ok: false, status: 404 });
    expect(match('POST', 'exports/products')).toEqual({ ok: false, status: 404 });
  });

  it('allows only the product import POST (IMP-01)', () => {
    expect(match('POST', 'imports/products')).toMatchObject({ ok: true, body: true });
    expect(match('GET', 'imports/products')).toEqual({ ok: false, status: 404 });
    expect(match('GET', 'imports/products/template')).toEqual({ ok: false, status: 404 });
  });

  it('allows asking for a verification e-mail without a body (USR-19)', () => {
    expect(match('POST', 'auth/email/verification')).toEqual({
      ok: true,
      path: 'auth/email/verification',
      search: new URLSearchParams(),
      body: false,
      raw: false,
    });
    expect(match('POST', 'auth/email/verify')).toEqual({ ok: false, status: 404 });
  });

  it('allows the dashboard KPIs read-only (DSH-02)', () => {
    expect(match('GET', 'dashboard/kpis', 'company_id=x')).toMatchObject({ ok: true, body: false });
    expect(match('POST', 'dashboard/kpis')).toEqual({ ok: false, status: 404 });
  });

  it('allows the sales report read-only (RPT-01)', () => {
    expect(
      match('GET', 'reports/sales', 'from=2026-11-01&to=2026-11-14&group_by=day&company_id=x&channel=manual'),
    ).toMatchObject({ ok: true, body: false });
    expect(match('POST', 'reports/sales')).toEqual({ ok: false, status: 404 });
    expect(match('GET', 'reports/sales', 'tenant=x')).toEqual({ ok: false, status: 400 });
    expect(match('GET', 'reports')).toEqual({ ok: false, status: 404 });
  });

  it('allows the order routes and nothing around them (ORD-03)', () => {
    expect(
      match('GET', 'orders', 'page=1&per_page=20&search=TY&status=created&company_id=x&channel=manual'),
    ).toMatchObject({ ok: true, body: false });
    expect(match('GET', `orders/${ID}`).ok).toBe(true);
    expect(match('POST', 'orders')).toMatchObject({ ok: true, body: true });
    expect(match('POST', `orders/${ID}/status`)).toMatchObject({ ok: true, body: true });
    expect(match('GET', 'orders', 'tenant_id=x')).toEqual({ ok: false, status: 400 });
    expect(match('PATCH', `orders/${ID}`)).toEqual({ ok: false, status: 404 });
    expect(match('DELETE', `orders/${ID}`)).toEqual({ ok: false, status: 404 });
    expect(match('GET', `orders/${ID}/status`)).toEqual({ ok: false, status: 404 });
    expect(match('POST', 'orders/not-a-uuid/status')).toEqual({ ok: false, status: 404 });
  });
});
