import type { SessionData, SessionStore } from './session-store';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export type RefreshResult =
  | { kind: 'ok'; tokens: TokenPair }
  /** The backend rejected the refresh token (revoked, expired, reused). */
  | { kind: 'invalid' }
  /** Backend unreachable or rate limited; the session is kept. */
  | { kind: 'unavailable'; retryAfter?: number };

export class SessionUnavailableError extends Error {
  constructor(readonly retryAfter = 5) {
    super('Oturum şu anda yenilenemiyor');
  }
}

interface Options {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Refresh this long before the access token actually expires. */
  skewMs?: number;
  lockTtlMs?: number;
  /** How long a request waits for another request's refresh to finish. */
  waitMs?: number;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function sessionFromTokens(
  tokens: TokenPair,
  user: { userId: string; tenantId: string },
  now: number,
): SessionData {
  return {
    ...user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: now + tokens.expiresIn * 1000,
    createdAt: now,
    selectedCompanyId: null,
    version: 1,
  };
}

/**
 * Loads a session and keeps its access token fresh. The backend treats a
 * refresh token used twice as stolen and ends every session of the user, so
 * concurrent requests must never refresh in parallel: one request takes a
 * Redis lock (works across BFF instances) and the others wait for its result.
 */
export class SessionManager {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly skewMs: number;
  private readonly lockTtlMs: number;
  private readonly waitMs: number;

  constructor(
    private readonly store: SessionStore,
    private readonly refresh: (refreshToken: string) => Promise<RefreshResult>,
    options: Options = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.skewMs = options.skewMs ?? 30_000;
    this.lockTtlMs = options.lockTtlMs ?? 10_000;
    this.waitMs = options.waitMs ?? 5_000;
  }

  /** A session with a usable access token, or null if the user must sign in again. */
  async resolve(sid: string): Promise<SessionData | null> {
    const session = await this.store.get(sid);
    if (!session) return null;
    if (!this.needsRefresh(session)) {
      await this.store.touch(sid, session);
      return session;
    }
    return this.refreshOnce(sid, session);
  }

  private needsRefresh(session: SessionData): boolean {
    return session.accessExpiresAt - this.skewMs <= this.now();
  }

  private async refreshOnce(
    sid: string,
    stale: SessionData,
  ): Promise<SessionData | null> {
    const owner = await this.store.lock(sid, this.lockTtlMs);
    if (!owner) return this.waitForRefresh(sid, stale.version);

    try {
      // Another request may have finished a refresh just before we got the lock.
      const current = await this.store.get(sid);
      if (!current) return null;
      if (!this.needsRefresh(current)) return current;

      const result = await this.refresh(current.refreshToken);
      if (result.kind === 'invalid') {
        await this.store.destroy(sid);
        return null;
      }
      if (result.kind === 'unavailable') {
        throw new SessionUnavailableError(result.retryAfter);
      }
      const next: SessionData = {
        ...current,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        accessExpiresAt: this.now() + result.tokens.expiresIn * 1000,
        version: current.version + 1,
      };
      await this.store.save(sid, next);
      return next;
    } finally {
      await this.store.unlock(sid, owner);
    }
  }

  private async waitForRefresh(
    sid: string,
    version: number,
  ): Promise<SessionData | null> {
    const deadline = this.now() + this.waitMs;
    while (this.now() < deadline) {
      await this.sleep(100);
      const session = await this.store.get(sid);
      if (!session) return null;
      if (session.version !== version) return session;
    }
    throw new SessionUnavailableError();
  }
}
