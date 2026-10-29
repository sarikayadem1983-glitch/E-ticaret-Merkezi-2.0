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

export type SendResult =
  | { kind: 'ok'; response: Response }
  /** The session was destroyed; the user must sign in again. */
  | { kind: 'signed-out' };

/** `error.code` of a standard error body, or null. Reads a clone. */
async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : null;
  } catch {
    return null;
  }
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
    return this.refreshOnce(sid, session, (s) => this.needsRefresh(s));
  }

  /**
   * Calls the backend with the session's access token. The backend checks the
   * membership on every request (spec "Oturum geçersizleştirme"):
   * - `401 TOKEN_STALE` (role or store changed): the tokens are refreshed once
   *   and the call is repeated once with the new access token.
   * - `401 SESSION_REVOKED`, any other 401, a rejected refresh or a second 401
   *   after the retry: the session is destroyed. Never loops.
   */
  async send(
    sid: string,
    session: SessionData,
    call: (accessToken: string) => Promise<Response>,
  ): Promise<SendResult> {
    const first = await call(session.accessToken);
    if (first.status !== 401) return { kind: 'ok', response: first };
    if ((await errorCode(first)) !== 'TOKEN_STALE') {
      return this.signOut(sid);
    }

    const refreshed = await this.forceRefresh(sid, session);
    if (!refreshed) return this.signOut(sid);
    const retry = await call(refreshed.accessToken);
    if (retry.status === 401) return this.signOut(sid);
    return { kind: 'ok', response: retry };
  }

  /**
   * Refreshes even though the access token has not expired, unless another
   * request already replaced the stale token. Same lock as resolve(), so a
   * refresh token is never used twice.
   */
  private forceRefresh(
    sid: string,
    stale: SessionData,
  ): Promise<SessionData | null> {
    return this.refreshOnce(
      sid,
      stale,
      (s) => s.accessToken === stale.accessToken,
    );
  }

  private async signOut(sid: string): Promise<SendResult> {
    await this.store.destroy(sid);
    return { kind: 'signed-out' };
  }

  private needsRefresh(session: SessionData): boolean {
    return session.accessExpiresAt - this.skewMs <= this.now();
  }

  private async refreshOnce(
    sid: string,
    stale: SessionData,
    stillNeeded: (current: SessionData) => boolean,
  ): Promise<SessionData | null> {
    const owner = await this.store.lock(sid, this.lockTtlMs);
    if (!owner) return this.waitForRefresh(sid, stale.version);

    try {
      // Another request may have finished a refresh just before we got the lock.
      const current = await this.store.get(sid);
      if (!current) return null;
      if (!stillNeeded(current)) return current;

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
