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
    ['POST', 'invitations', ''],
    ['POST', `invitations/${ID}/revoke`, ''],
  ])('allows %s %s', (method, path, query) => {
    expect(match(method, path, query)).toMatchObject({ ok: true, path });
  });

  it('forwards a body only where the route takes one', () => {
    expect(match('POST', 'companies')).toMatchObject({ body: true });
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
    ['accept-as-current (USR-T10b)', 'POST', 'invitations/accept-as-current'],
    ['resend (USR-T13b)', 'POST', `invitations/${ID}/resend`],
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
    expect(match('GET', 'invitations', 'status=pending')).toEqual({ ok: false, status: 400 });
  });

  it.each([
    ['endpoint not exposed', 'GET', 'audit-logs'],
    ['auth endpoint', 'POST', 'auth/refresh'],
    ['auth endpoint', 'POST', 'auth/logout'],
    ['auth endpoint', 'POST', 'auth/switch-tenant'],
    ['wrong method', 'POST', 'auth/memberships'],
    ['health', 'GET', 'health'],
    ['wrong method', 'DELETE', `companies/${ID}`],
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

  it('refuses unknown or oversized query parameters', () => {
    expect(match('GET', 'companies', 'tenantId=x')).toEqual({ ok: false, status: 400 });
    expect(match('GET', 'companies', `search=${'a'.repeat(101)}`)).toEqual({
      ok: false,
      status: 400,
    });
    expect(match('GET', 'companies/summary', 'page=1')).toEqual({ ok: false, status: 400 });
  });
});
