import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { Redis } from 'ioredis';

/** Signed out after this long without a request. */
export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Signed out this long after login, whatever the activity. */
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export interface SessionData {
  userId: string;
  tenantId: string;
  accessToken: string;
  /** Epoch ms when the access token expires. */
  accessExpiresAt: number;
  refreshToken: string;
  /** Epoch ms of login; the absolute timeout counts from here. */
  createdAt: number;
  selectedCompanyId: string | null;
  /** Bumped on every token rotation; waiters use it to see a finished refresh. */
  version: number;
}

const KEY_PREFIX = 'bff:sess:';
const LOCK_PREFIX = 'bff:lock:';

// Deletes the lock only if we still own it, so a slow holder never frees someone else's lock.
const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/** Session ids are 256-bit random values; Redis only ever sees their SHA-256. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionId(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

const SID_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedSessionId(sid: string | undefined): sid is string {
  return typeof sid === 'string' && SID_FORMAT.test(sid);
}

/**
 * Server-side session store. Tokens are encrypted at rest (AES-256-GCM, key
 * derived from SESSION_SECRET) and bound to their session key, so a Redis dump
 * or a swapped value does not yield usable tokens.
 */
export class SessionStore {
  private readonly key: Buffer;

  constructor(
    private readonly redis: Redis,
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = Buffer.from(
      hkdfSync('sha256', secret, 'tm-bff', 'session-encryption', 32),
    );
  }

  async create(data: SessionData): Promise<string> {
    const sid = newSessionId();
    await this.save(sid, data);
    return sid;
  }

  /** Returns null for unknown, idle-expired or absolutely expired sessions. */
  async get(sid: string): Promise<SessionData | null> {
    const id = hashSessionId(sid);
    const blob = await this.redis.get(KEY_PREFIX + id);
    if (!blob) return null;
    const data = this.decrypt(blob, id);
    if (!data || this.now() - data.createdAt >= ABSOLUTE_TIMEOUT_MS) {
      await this.destroy(sid);
      return null;
    }
    return data;
  }

  /** Writes the session and restarts its idle timer (never past the absolute limit). */
  async save(sid: string, data: SessionData): Promise<void> {
    const id = hashSessionId(sid);
    const ttl = this.ttl(data);
    if (ttl <= 0) {
      await this.destroy(sid);
      return;
    }
    await this.redis.set(KEY_PREFIX + id, this.encrypt(data, id), 'PX', ttl);
  }

  /** Sliding idle timeout: called on every authenticated request. */
  async touch(sid: string, data: SessionData): Promise<void> {
    const ttl = this.ttl(data);
    if (ttl > 0) await this.redis.pexpire(KEY_PREFIX + hashSessionId(sid), ttl);
  }

  async destroy(sid: string): Promise<void> {
    await this.redis.del(KEY_PREFIX + hashSessionId(sid));
  }

  /** Cross-instance lock for one session's token refresh. Returns the owner token or null. */
  async lock(sid: string, ttlMs: number): Promise<string | null> {
    const owner = randomBytes(16).toString('hex');
    const ok = await this.redis.set(
      LOCK_PREFIX + hashSessionId(sid),
      owner,
      'PX',
      ttlMs,
      'NX',
    );
    return ok === 'OK' ? owner : null;
  }

  async unlock(sid: string, owner: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK, 1, LOCK_PREFIX + hashSessionId(sid), owner);
  }

  private ttl(data: SessionData): number {
    const remaining = data.createdAt + ABSOLUTE_TIMEOUT_MS - this.now();
    return Math.min(IDLE_TIMEOUT_MS, remaining);
  }

  private encrypt(data: SessionData, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  private decrypt(blob: string, aad: string): SessionData | null {
    try {
      const raw = Buffer.from(blob, 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        raw.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(raw.subarray(12, 28));
      const json = Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(json) as SessionData;
    } catch {
      return null;
    }
  }
}
