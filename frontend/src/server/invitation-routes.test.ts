import { POST as accept } from '@/app/api/invitations/accept/route';
import { POST as lookup } from '@/app/api/invitations/lookup/route';
import nextConfig from '../../next.config';
import { backendFetch } from './backend-client';
import { currentSession, startSession } from './session';

vi.mock('./backend-client', () => ({ backendFetch: vi.fn() }));
vi.mock('./session', () => ({ currentSession: vi.fn(), startSession: vi.fn() }));

const fetchMock = vi.mocked(backendFetch);
const APP = 'http://localhost:3000';
const TOKEN = 'a'.repeat(43);

const valid = {
  origin: APP,
  'x-tm-csrf': '1',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
  'x-tm-client-ip': '203.0.113.7',
};

const post = (path: string, body: unknown, headers: Record<string, string> = valid) =>
  new Request(`${APP}${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' },
  });

beforeEach(() => fetchMock.mockReset());

describe.each([
  ['lookup', lookup, '/api/invitations/lookup', 'invitations/lookup', { token: TOKEN }],
  [
    'accept',
    accept,
    '/api/invitations/accept',
    'invitations/accept',
    { token: TOKEN, name: 'Ayşe', password: 'Correct-Horse-9' },
  ],
] as const)('POST /api/invitations/%s', (_name, handler, url, backendPath, body) => {
  it('forwards only the known fields, without a session or token', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));
    const res = await handler(post(url, { ...body, tenantId: 'x', role: 'owner' }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(backendPath);
    expect(init).toMatchObject({ method: 'POST', body });
    expect(init.body).toEqual(body);
    expect(init.accessToken).toBeUndefined();
    expect(init.client.ip).toBe('203.0.113.7');
  });

  it('ignores __proto__ / constructor keys and forwards nothing extra', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));
    const raw = `{"__proto__":{"isAdmin":true},"constructor":{"x":1},${JSON.stringify(body).slice(1)}`;
    await handler(post(url, raw));
    const forwarded = fetchMock.mock.calls[0][1].body as Record<string, unknown>;
    expect(forwarded).toEqual(body);
    expect(Object.keys(forwarded).sort()).toEqual(Object.keys(body).sort());
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('never uses an existing session cookie', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ok: true } }));
    const res = await handler(post(url, body, { ...valid, cookie: 'tm_sid=some-session-id' }));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].accessToken).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(vi.mocked(currentSession)).not.toHaveBeenCalled();
    expect(vi.mocked(startSession)).not.toHaveBeenCalled();
  });

  it('relays the backend status and body, not its headers', async () => {
    fetchMock.mockResolvedValue(
      json(404, { error: { code: 'INVITATION_INVALID', message: 'x', details: [] } }),
    );
    const res = await handler(post(url, body));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('INVITATION_INVALID');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps Retry-After on 429', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"error":{"code":"TOO_MANY_REQUESTS"}}', {
        status: 429,
        headers: { 'retry-after': '30' },
      }),
    );
    const res = await handler(post(url, body));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it.each([
    ['no origin', { ...valid, origin: '' }],
    ['other origin', { ...valid, origin: 'https://evil.example' }],
    ['cross-site', { ...valid, 'sec-fetch-site': 'cross-site' }],
    ['no csrf header', { ...valid, 'x-tm-csrf': '' }],
  ])('refuses %s (CSRF) before calling the backend', async (_n, headers) => {
    const res = await handler(post(url, body, headers as Record<string, string>));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-JSON or non-object body', async () => {
    expect((await handler(post(url, 'x', { ...valid, 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await handler(post(url, '{bad'))).status).toBe(400);
    expect((await handler(post(url, '[1,2]'))).status).toBe(400);
    expect((await handler(post(url, 'null'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('next.config headers', () => {
  it('sends no Referrer on invitation pages (token in the URL)', async () => {
    const rules = await nextConfig.headers!();
    const invite = rules.filter((r) => r.source === '/invite/:path*');
    expect(invite).toHaveLength(1);
    expect(invite[0].headers).toContainEqual({ key: 'Referrer-Policy', value: 'no-referrer' });
    // Later rules win in Next.js: the invite rule must come after the catch-all.
    const all = rules.findIndex((r) => r.source === '/:path*');
    expect(rules.indexOf(invite[0])).toBeGreaterThan(all);
  });
});
