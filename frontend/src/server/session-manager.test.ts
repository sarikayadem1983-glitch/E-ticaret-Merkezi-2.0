import { Redis } from 'ioredis';
import {
  type RefreshResult,
  SessionManager,
  SessionUnavailableError,
} from './session-manager';
import { type SessionData, SessionStore } from './session-store';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const store = new SessionStore(redis, 'test-secret-that-is-at-least-32-characters-long');

afterAll(() => redis.disconnect());

function expired(overrides: Partial<SessionData> = {}): SessionData {
  return {
    userId: 'u1',
    tenantId: 't1',
    accessToken: 'old-access',
    accessExpiresAt: Date.now() - 1000,
    refreshToken: 'old-refresh',
    createdAt: Date.now(),
    selectedCompanyId: 'c1',
    version: 1,
    ...overrides,
  };
}

const ok = (n: number): RefreshResult => ({
  kind: 'ok',
  tokens: { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 900 },
});

describe('SessionManager', () => {
  it('returns a fresh session without calling refresh', async () => {
    const refresh = vi.fn();
    const sid = await store.create(expired({ accessExpiresAt: Date.now() + 600_000 }));
    const session = await new SessionManager(store, refresh).resolve(sid);
    expect(session?.accessToken).toBe('old-access');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns null for an unknown session', async () => {
    const manager = new SessionManager(store, vi.fn());
    expect(await manager.resolve('x'.repeat(43))).toBeNull();
  });

  it('rotates tokens and keeps the rest of the session', async () => {
    const refresh = vi.fn().mockResolvedValue(ok(1));
    const sid = await store.create(expired());
    const session = await new SessionManager(store, refresh).resolve(sid);
    expect(refresh).toHaveBeenCalledWith('old-refresh');
    expect(session).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      selectedCompanyId: 'c1',
      version: 2,
    });
    expect((await store.get(sid))?.refreshToken).toBe('refresh-1');
  });

  it('refreshes exactly once for many concurrent requests (no refresh token reuse)', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
      return ok(calls);
    });
    const sid = await store.create(expired());
    // Separate managers model separate requests, possibly on separate BFF instances.
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        new SessionManager(store, refresh, { sleep: (ms) => new Promise((r) => setTimeout(r, ms / 4)) }).resolve(sid),
      ),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((s) => s?.accessToken))).toEqual(new Set(['access-1']));
  });

  it('ends the session when the backend rejects the refresh token', async () => {
    const sid = await store.create(expired());
    const manager = new SessionManager(store, vi.fn().mockResolvedValue({ kind: 'invalid' }));
    expect(await manager.resolve(sid)).toBeNull();
    expect(await store.get(sid)).toBeNull();
  });

  it('keeps the session and reports 503 when the backend is unavailable', async () => {
    const sid = await store.create(expired());
    const manager = new SessionManager(
      store,
      vi.fn().mockResolvedValue({ kind: 'unavailable', retryAfter: 7 }),
    );
    const error = await manager.resolve(sid).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionUnavailableError);
    expect((error as SessionUnavailableError).retryAfter).toBe(7);
    expect((await store.get(sid))?.refreshToken).toBe('old-refresh');
    // The lock was released, so a later request can try again.
    expect(await store.lock(sid, 1000)).toBeTruthy();
  });

  it('gives up waiting for a refresh held by a stuck request', async () => {
    const sid = await store.create(expired());
    await store.lock(sid, 10_000);
    let now = Date.now();
    const manager = new SessionManager(store, vi.fn(), {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      waitMs: 1000,
    });
    await expect(manager.resolve(sid)).rejects.toBeInstanceOf(SessionUnavailableError);
  });
});
