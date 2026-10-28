import { Redis } from 'ioredis';
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  type SessionData,
  SessionStore,
  hashSessionId,
  isWellFormedSessionId,
} from './session-store';

// Runs against the real Redis from docker compose (REDIS_URL).
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    userId: 'u1',
    tenantId: 't1',
    accessToken: 'ACCESS.TOKEN.VALUE',
    accessExpiresAt: Date.now() + 60_000,
    refreshToken: 'REFRESH_TOKEN_VALUE',
    createdAt: Date.now(),
    selectedCompanyId: null,
    version: 1,
    ...overrides,
  };
}

afterAll(() => redis.disconnect());

describe('SessionStore', () => {
  it('issues 256-bit random, well-formed session ids', async () => {
    const store = new SessionStore(redis, SECRET);
    const a = await store.create(session());
    const b = await store.create(session());
    expect(a).not.toBe(b);
    expect(isWellFormedSessionId(a)).toBe(true);
    expect(isWellFormedSessionId('short')).toBe(false);
    expect(isWellFormedSessionId('a'.repeat(42) + '!')).toBe(false);
  });

  it('stores only the hash of the id and encrypts tokens at rest', async () => {
    const store = new SessionStore(redis, SECRET);
    const sid = await store.create(session());
    expect(await redis.exists(`bff:sess:${sid}`)).toBe(0);
    const raw = await redis.get(`bff:sess:${hashSessionId(sid)}`);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('ACCESS');
    expect(raw).not.toContain('REFRESH');
    expect((await store.get(sid))?.accessToken).toBe('ACCESS.TOKEN.VALUE');
  });

  it('rejects tampered data, a value moved to another key and a different secret', async () => {
    const store = new SessionStore(redis, SECRET);
    const sid = await store.create(session());
    const key = `bff:sess:${hashSessionId(sid)}`;
    const raw = (await redis.get(key))!;

    const other = await store.create(session());
    await redis.set(`bff:sess:${hashSessionId(other)}`, raw);
    expect(await store.get(other)).toBeNull();

    expect(await new SessionStore(redis, `${SECRET}-other`).get(sid)).toBeNull();

    const flipped = Buffer.from(raw, 'base64url');
    flipped[flipped.length - 1] ^= 1;
    await redis.set(key, flipped.toString('base64url'));
    expect(await store.get(sid)).toBeNull();
  });

  it('applies the idle timeout as the Redis TTL', async () => {
    const store = new SessionStore(redis, SECRET);
    const sid = await store.create(session());
    const ttl = await redis.pttl(`bff:sess:${hashSessionId(sid)}`);
    expect(ttl).toBeGreaterThan(IDLE_TIMEOUT_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(IDLE_TIMEOUT_MS);
  });

  it('never extends a session past the absolute timeout', async () => {
    const store = new SessionStore(redis, SECRET);
    const createdAt = Date.now() - ABSOLUTE_TIMEOUT_MS + 10_000;
    const sid = await store.create(session({ createdAt }));
    const ttl = await redis.pttl(`bff:sess:${hashSessionId(sid)}`);
    expect(ttl).toBeLessThanOrEqual(10_000);

    const later = new SessionStore(redis, SECRET, () => Date.now() + 20_000);
    expect(await later.get(sid)).toBeNull();
    expect(await redis.exists(`bff:sess:${hashSessionId(sid)}`)).toBe(0);
  });

  it('destroys sessions', async () => {
    const store = new SessionStore(redis, SECRET);
    const sid = await store.create(session());
    await store.destroy(sid);
    expect(await store.get(sid)).toBeNull();
  });

  it('gives the refresh lock to one owner and only that owner can release it', async () => {
    const store = new SessionStore(redis, SECRET);
    const sid = await store.create(session());
    const owner = await store.lock(sid, 5000);
    expect(owner).toBeTruthy();
    expect(await store.lock(sid, 5000)).toBeNull();
    await store.unlock(sid, 'someone-else');
    expect(await store.lock(sid, 5000)).toBeNull();
    await store.unlock(sid, owner!);
    expect(await store.lock(sid, 5000)).toBeTruthy();
  });
});
