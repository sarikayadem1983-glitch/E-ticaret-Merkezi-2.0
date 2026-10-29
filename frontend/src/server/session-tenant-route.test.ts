import { POST } from '@/app/api/session/tenant/route';
import { backendFetch, refreshTokens } from './backend-client';
import { redis } from './redis';
import { currentSession, sessionStore } from './session';
import { type SessionData, SessionStore } from './session-store';

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

  const jwt = (claims: Record<string, unknown>) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

  /** switch-tenant succeeds with a JWT access token; auth/me fails. */
  function switchesButMeFails(
    accessToken: string,
    meFails: () => Promise<Response>,
  ) {
    fetchMock.mockImplementation(async (path) => {
      if (path === 'auth/switch-tenant') {
        return json(200, {
          data: { accessToken, refreshToken: 'refresh-B', expiresIn: 900 },
        });
      }
      if (path === 'auth/me') return meFails();
      return json(404, {});
    });
  }

  it.each([
    ['an error status', () => Promise.resolve(json(500, {}))],
    ['a network failure', () => Promise.reject(new Error('ECONNRESET'))],
  ])(
    'keeps the new tokens from the token claims when auth/me fails with %s',
    async (_n, meFails) => {
      const oldSid = await signedInAsA();
      switchesButMeFails(jwt({ sub: USER, tid: TENANT_B }), meFails);

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(204);
      const newSid = jar.get(COOKIE)!;
      expect(newSid).not.toBe(oldSid);
      const store = await sessionStore();
      // The old session held the refresh token the backend just revoked.
      expect(await store.get(oldSid)).toBeNull();
      expect(await store.get(newSid)).toMatchObject({
        userId: USER,
        tenantId: TENANT_B,
        refreshToken: 'refresh-B',
        selectedCompanyId: null,
        createdAt,
      });
      await store.destroy(newSid);
    },
  );

  it('the next refresh after a switch with a failed auth/me uses the new refresh token (no reuse)', async () => {
    await signedInAsA();
    switchesButMeFails(jwt({ sub: USER, tid: TENANT_B }), () =>
      Promise.resolve(json(502, {})),
    );
    expect((await POST(post({ tenantId: TENANT_B }))).status).toBe(204);
    const sid = jar.get(COOKIE)!;
    const store = await sessionStore();
    const session = (await store.get(sid))!;
    await store.save(sid, { ...session, accessExpiresAt: Date.now() - 1 });

    const refresh = vi.mocked(refreshTokens);
    refresh.mockReset();
    refresh.mockResolvedValue({
      kind: 'ok',
      tokens: {
        accessToken: 'access-B2',
        refreshToken: 'refresh-B2',
        expiresIn: 900,
      },
    } as never);
    const resolved = await currentSession({ ip: '127.0.0.1', userAgent: 't' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toBe('refresh-B');
    expect(refresh.mock.calls.flat()).not.toContain('refresh-A');
    expect(resolved?.session.tenantId).toBe(TENANT_B);
    await store.destroy(sid);
  });

  it('destroys the old session and answers 401 when no new session can be built', async () => {
    const oldSid = await signedInAsA();
    switchesButMeFails('not-a-jwt', () => Promise.resolve(json(500, {})));

    const res = await POST(post({ tenantId: TENANT_B }));
    expect(res.status).toBe(401);
    expect(jar.get(COOKIE)).toBeUndefined();
    expect(await (await sessionStore()).get(oldSid)).toBeNull();
  });

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

  describe('session store failure after the backend switched (INF-18)', () => {
    const redisDown = () => new Error('Connection is closed.');

    it('answers 503, aborts the switch and keeps the old session', async () => {
      const sid = await signedInAsA();
      backendSwitchesToB();
      const store = await sessionStore();
      const create = vi
        .spyOn(SessionStore.prototype, 'create')
        .mockRejectedValueOnce(redisDown());
      try {
        const res = await POST(post({ tenantId: TENANT_B }));
        expect(res.status).toBe(503);
        expect(JSON.stringify(await res.json())).not.toMatch(/refresh-/);
      } finally {
        create.mockRestore();
      }

      expect(fetchMock).toHaveBeenCalledWith(
        'auth/switch-tenant/abort',
        expect.objectContaining({
          method: 'POST',
          body: {
            refreshToken: 'refresh-B',
            previousRefreshToken: 'refresh-A',
          },
        }),
      );
      // The browser keeps the old session; its next refresh uses refresh-A,
      // which the abort reactivated, so no reuse alarm is raised.
      expect(jar.get(COOKIE)).toBe(sid);
      expect(await store.get(sid)).toMatchObject({
        tenantId: TENANT_A,
        refreshToken: 'refresh-A',
      });
      const owner = await store.lock(sid, 1000);
      expect(owner).toBeTruthy();
      await store.unlock(sid, owner!);
      await store.destroy(sid);
    });

    it('still answers 503 when the abort call itself fails', async () => {
      const sid = await signedInAsA();
      backendSwitchesToB();
      const switched = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (path, init) => {
        if (path === 'auth/switch-tenant/abort')
          throw new Error('ECONNREFUSED');
        return switched(path, init);
      });
      const store = await sessionStore();
      const create = vi
        .spyOn(SessionStore.prototype, 'create')
        .mockRejectedValueOnce(redisDown());
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await POST(post({ tenantId: TENANT_B }));
        expect(res.status).toBe(503);
      } finally {
        create.mockRestore();
        log.mockRestore();
      }
      expect(jar.get(COOKIE)).toBe(sid);
      await store.destroy(sid);
    });

    it('does not abort once the new session is stored (old one is left to its TTL)', async () => {
      const oldSid = await signedInAsA();
      backendSwitchesToB();
      const store = await sessionStore();
      const destroy = vi
        .spyOn(SessionStore.prototype, 'destroy')
        .mockRejectedValueOnce(redisDown());
      let res: Response;
      try {
        res = await POST(post({ tenantId: TENANT_B }));
      } finally {
        destroy.mockRestore();
      }
      expect(res.status).toBe(204);
      expect(fetchMock).not.toHaveBeenCalledWith(
        'auth/switch-tenant/abort',
        expect.anything(),
      );
      const newSid = jar.get(COOKIE)!;
      expect(newSid).not.toBe(oldSid);
      expect(await store.get(newSid)).toMatchObject({
        tenantId: TENANT_B,
        refreshToken: 'refresh-B',
      });
      await store.destroy(oldSid);
      await store.destroy(newSid);
    });
  });

  describe('per-request revocation', () => {
    const stale = () =>
      json(401, { error: { code: 'TOKEN_STALE', message: 'x', details: [] } });
    const revoked = () =>
      json(401, {
        error: { code: 'SESSION_REVOKED', message: 'x', details: [] },
      });
    const refresh = vi.mocked(refreshTokens);
    const refreshedA = {
      kind: 'ok',
      tokens: {
        accessToken: 'access-A2',
        refreshToken: 'refresh-A2',
        expiresIn: 900,
      },
    } as never;

    beforeEach(() => refresh.mockReset());

    it('refreshes once after TOKEN_STALE and retries the switch once', async () => {
      const oldSid = await signedInAsA();
      refresh.mockResolvedValue(refreshedA);
      const switchBodies: unknown[] = [];
      fetchMock.mockImplementation(async (path, init) => {
        if (path === 'auth/switch-tenant') {
          switchBodies.push({ token: init?.accessToken, body: init?.body });
          if (init?.accessToken === 'access-A') return stale();
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

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(204);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(refresh.mock.calls[0][0]).toBe('refresh-A');
      expect(switchBodies).toEqual([
        {
          token: 'access-A',
          body: { tenantId: TENANT_B, refreshToken: 'refresh-A' },
        },
        {
          token: 'access-A2',
          body: { tenantId: TENANT_B, refreshToken: 'refresh-A2' },
        },
      ]);
      const store = await sessionStore();
      expect(await store.get(oldSid)).toBeNull();
      const newSid = jar.get(COOKIE)!;
      expect(await store.get(newSid)).toMatchObject({
        tenantId: TENANT_B,
        refreshToken: 'refresh-B',
      });
      await store.destroy(newSid);
    });

    it('destroys the session when the retry is stale again (no loop)', async () => {
      const sid = await signedInAsA();
      refresh.mockResolvedValue(refreshedA);
      fetchMock.mockImplementation(async () => stale());

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(jar.get(COOKIE)).toBeUndefined();
      expect(await (await sessionStore()).get(sid)).toBeNull();
    });

    it('destroys the session when the refresh after TOKEN_STALE is rejected', async () => {
      const sid = await signedInAsA();
      refresh.mockResolvedValue({ kind: 'invalid' } as never);
      fetchMock.mockImplementation(async () => stale());

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(jar.get(COOKIE)).toBeUndefined();
      expect(await (await sessionStore()).get(sid)).toBeNull();
    });

    it('destroys the session on SESSION_REVOKED without refreshing', async () => {
      const sid = await signedInAsA();
      fetchMock.mockImplementation(async () => revoked());

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(jar.get(COOKIE)).toBeUndefined();
      expect(await (await sessionStore()).get(sid)).toBeNull();
    });

    it('releases the session lock after a TOKEN_STALE retry', async () => {
      const sid = await signedInAsA();
      refresh.mockResolvedValue(refreshedA);
      fetchMock.mockImplementation(async (path, init) =>
        init?.accessToken === 'access-A'
          ? stale()
          : json(404, { error: { code: 'TENANT_NOT_FOUND', message: 'x' } }),
      );

      const res = await POST(post({ tenantId: TENANT_B }));
      expect(res.status).toBe(404);
      const store = await sessionStore();
      expect(await store.get(sid)).toMatchObject({
        tenantId: TENANT_A,
        accessToken: 'access-A2',
        refreshToken: 'refresh-A2',
      });
      const owner = await store.lock(sid, 1000);
      expect(owner).toBeTruthy();
      await store.unlock(sid, owner!);
      await store.destroy(sid);
    });
  });
});
