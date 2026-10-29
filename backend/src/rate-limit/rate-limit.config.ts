/** At most `limit` requests per fixed window. */
export interface FixedWindowPolicy {
  limit: number;
  windowMs: number;
}

/**
 * The first `free` attempts pass; after that each attempt must wait
 * `baseMs * 2^(n - free)` (capped at `maxMs`) since the previous one.
 * The counter is forgotten `windowMs` after the last attempt.
 */
export interface BackoffPolicy {
  free: number;
  baseMs: number;
  maxMs: number;
  windowMs: number;
}

export interface AuthRateLimits {
  /** Every login attempt from one IP, whatever the account. Stops credential stuffing. */
  loginPerIp: FixedWindowPolicy;
  /** Attempts on one account from one IP. An attacker can only slow down themselves. */
  loginPerAccountIp: BackoffPolicy;
  /** Attempts on one account from all IPs. Distributed guessing; skipped for trusted IPs. */
  loginPerAccount: BackoffPolicy;
  /** How long an IP stays trusted for an account after a successful login. */
  trustedIpTtlMs: number;
  registerPerIp: FixedWindowPolicy;
  refreshPerIp: FixedWindowPolicy;
  /** Public invitation endpoints: token guessing and account probing. */
  invitationLookupPerIp: FixedWindowPolicy;
  invitationAcceptPerIp: FixedWindowPolicy;
}

export const AUTH_RATE_LIMITS = Symbol('AUTH_RATE_LIMITS');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  loginPerIp: { limit: 30, windowMs: 15 * MINUTE },
  loginPerAccountIp: {
    free: 5,
    baseMs: 30 * SECOND,
    maxMs: 15 * MINUTE,
    windowMs: HOUR,
  },
  loginPerAccount: {
    free: 20,
    baseMs: MINUTE,
    maxMs: 15 * MINUTE,
    windowMs: HOUR,
  },
  trustedIpTtlMs: 30 * 24 * HOUR,
  registerPerIp: { limit: 5, windowMs: HOUR },
  refreshPerIp: { limit: 30, windowMs: MINUTE },
  invitationLookupPerIp: { limit: 10, windowMs: MINUTE },
  invitationAcceptPerIp: { limit: 10, windowMs: MINUTE },
};
