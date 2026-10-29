import { POST } from '@/app/api/session/tenant/route';
import { backendFetch } from './backend-client';
import { redis } from './redis';
import { currentSession, sessionStore } from './session';
import type { SessionData } from './session-store';

const { jar } = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => {
      if (value) jar.set(name, value);
      else jar.delete(name);
    },
  }),
}));

vi.mock('./backend-client', () => ({
  backendFetch: vi.fn(),
  refreshTokens: vi.fn(),
}));

const fetchMock = vi.mocked(backendFetch);
const APP = 'http://localhost:3000';
const COOKIE = 'tm_sid';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

const valid = {
  origin: APP,
  'x-tm-csrf': '1',
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
};

function post(body: unknown, headers: Record<string, string> = valid) {
  return new Request(`${APP}/api/session/tenant`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const createdAt = Date.now() - 60_000;

async function signedInAsA(): Promise<string> {
  const data: SessionData = {
    userId: USER,
    tenantId: TENANT_A,
    accessToken: 'access-A',
    accessExpiresAt: Date.now() + 600_000,
    refreshToken: 'refresh-A',
    createdAt,
    selectedCompanyId: '44444444-4444-4444-8444-444444444444',
    version: 3,
  };
  const sid = await (await sessionStore()).create(data);
  jar.set(COOKIE, sid);
  return sid;
}

/** Backend double: switch-tenant succeeds for B, auth/me answers for the new token. */
function backendSwitchesToB() {
  fetchMock.mockImplementation(async (path) => {
    if (path === 'auth/switch-tenant') {
      return json(200, {
        data: {
          accessToken: 'access-B',
          refreshToken: 'refresh-B',
          expiresIn: 900,
        },
      });
    }
    if (path === 'auth/me') {
      return json(200, { data: { id: USER, tenantId: TENANT_B } });
    }
    return json(404, {});
  });
}

beforeEach(() => {
  jar.clear();
  fetchMock.mockReset();
});

afterAll(() => redis().disconnect());

describe('POST /api/session/tenant', () => {
  it.each([
    ['cross-site Origin', { ...valid, origin: 'https://evil.example' }],
    ['cross-site fetch metadata', { ...valid, 'sec-fetch-site': 'cross-site' }],
    [
      'missing CSRF header',
      { origin: APP, 'content-type': 'application/json' },
    ],
  ])(
    'rejects %s with 403 and leaves the session alone',
    async (_n, headers) => {
      const sid = await signedInAsA();
      const res = await POST(post({ tenantId: TENANT_B }, headers));
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jar.get(COOKIE)).toBe(sid);
      expect((await (await sessionStore()).get(sid))?.tenantId).toBe(TENANT_A);
    },
  );

  it('requires a session', async () => {
    const res = await POST(post({ tenantId: TENANT_B }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ tenantId: 'x' }],
    [{ tenantId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }],
  ])('rejects an invalid tenant id %j with 422', async (body) => {
    await signedInAsA();
    expect((await POST(post(body))).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('switches with a new session id, destroys the old one and resets the company', async () => {
    const oldSid = await signedInAsA();
    backendSwitchesToB();

    const res = await POST(post({ tenantId: TENANT_B }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    expect(fetchMock).toHaveBeenCalledWith(
      'auth/switch-tenant',
      expect.objectContaining({
        method: 'POST',
        accessToken: 'access-A',
        body: { tenantId: TENANT_B, refreshToken: 'refresh-A' },
      }),
    );

    const newSid = jar.get(COOKIE);
    expect(newSid).toBeDefined();
    expect(newSid).not.toBe(oldSid);

    const store = await sessionStore();
    // Old BFF session id no longer works.
    expect(await store.get(oldSid)).toBeNull();
    jar.set(COOKIE, oldSid);
    expect(
      await currentSession({ ip: '127.0.0.1', userAgent: 't' }),
    ).toBeNull();

    const next = await store.get(newSid!);
    expect(next).toMatchObject({
      userId: USER,
      tenantId: TENANT_B,
      accessToken: 'access-B',
      refreshToken: 'refresh-B',
      selectedCompanyId: null,
      // The absolute timeout keeps counting from the original login.
      createdAt,
    });
    await store.destroy(newSid!);
  });

  it('relays 404 for a store without active membership and keeps the current session', async () => {
    const sid = await signedInAsA();
    fetchMock.mockResolvedValue(
      json(404, {
        error: { code: 'TENANT_NOT_FOUND', message: 'Mağaza bulunamadı' },
      }),
    );
    const res = await POST(post({ tenantId: TENANT_B }));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jar.get(COOKIE)).toBe(sid);
    const kept = await (await sessionStore()).get(sid);
    expect(kept).toMatchObject({
      tenantId: TENANT_A,
      accessToken: 'access-A',
      refreshToken: 'refresh-A',
      selectedCompanyId: '44444444-4444-4444-8444-444444444444',
    });
    await (await sessionStore()).destroy(sid);
  });

  it.each([
    ['an error status', () => Promise.resolve(json(500, {}))],
    ['a network failure', () => Promise.reject(new Error('ECONNRESET'))],
  ])(
    'answers 503 and keeps the current session when auth/me fails with %s',
    async (_n, meFails) => {
      const sid = await signedInAsA();
      backendSwitchesToB();
      const switched = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation((path, init) =>
        path === 'auth/me' ? meFails() : switched(path, init),
      );

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain('access-B');
      // The cookie and the old session id survive; no new session is created.
      expect(jar.get(COOKIE)).toBe(sid);
      const store = await sessionStore();
      expect(await store.get(sid)).toMatchObject({
        tenantId: TENANT_A,
        accessToken: 'access-A',
      });
      await store.destroy(sid);
    },
  );

  it('refuses to switch while a token refresh of the session is running', async () => {
    const sid = await signedInAsA();
    const store = await sessionStore();
    const owner = await store.lock(sid, 5_000);
    const res = await POST(post({ tenantId: TENANT_B }));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await store.unlock(sid, owner!);
    await store.destroy(sid);
  });
});
