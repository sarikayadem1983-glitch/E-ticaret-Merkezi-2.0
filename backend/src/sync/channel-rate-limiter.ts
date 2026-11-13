import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../rate-limit/redis.provider.js';
import { SyncError } from './sync-errors.js';

export interface ChannelRatePolicy {
  /** Bucket size: requests that may go out back to back. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

/**
 * Default request budgets per channel account. NOT verified marketplace limits:
 * Trendyol's official limit was not confirmed (no rate-limit headers on a
 * read-only check, 2026-11-13). Override with SYNC_RATE_<CHANNEL>=capacity:refill.
 * Live calls stay disabled (SYNC_LIVE_CALLS) until the official limit is verified.
 */
export const DEFAULT_CHANNEL_RATE_POLICIES: Readonly<
  Record<string, ChannelRatePolicy>
> = {
  trendyol: { capacity: 10, refillPerSecond: 5 },
};
const FALLBACK_POLICY: ChannelRatePolicy = { capacity: 5, refillPerSecond: 1 };

/** Reads SYNC_RATE_<CHANNEL> overrides ("10:5"). Invalid values stop the app. */
export function ratePolicies(
  env: Record<string, string | undefined>,
): Record<string, ChannelRatePolicy> {
  const policies: Record<string, ChannelRatePolicy> = {
    ...DEFAULT_CHANNEL_RATE_POLICIES,
  };
  for (const [key, value] of Object.entries(env)) {
    const m = /^SYNC_RATE_([A-Z0-9_]+)$/.exec(key);
    if (!m || value === undefined || value === '') continue;
    const parts = /^(\d{1,5}):(\d{1,5}(?:\.\d{1,3})?)$/.exec(value.trim());
    const capacity = parts ? Number(parts[1]) : NaN;
    const refill = parts ? Number(parts[2]) : NaN;
    if (!(capacity >= 1) || !(refill > 0)) {
      throw new Error(
        `${key} geçersiz; beklenen biçim kapasite:saniyelik_yenileme`,
      );
    }
    policies[m[1].toLowerCase().replaceAll('_', '-')] = {
      capacity,
      refillPerSecond: refill,
    };
  }
  return policies;
}

export const CHANNEL_RATE_POLICIES = Symbol('CHANNEL_RATE_POLICIES');

// Token bucket on the Redis clock, shared by every worker and app instance.
// KEYS[1] bucket hash. ARGV: capacity, refill per ms, tokens wanted, ttl ms.
// Returns 0 when the tokens were taken, else the wait in ms (nothing is taken).
const TAKE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local cap, rate, want = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'k') or ARGV[1])
local last = tonumber(redis.call('HGET', KEYS[1], 'l') or now)
tokens = math.min(cap, tokens + math.max(0, now - last) * rate)
if tokens >= want then
  redis.call('HSET', KEYS[1], 'k', tokens - want, 'l', now)
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return 0
end
redis.call('HSET', KEYS[1], 'k', tokens, 'l', now)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return math.ceil((want - tokens) / rate)`;

@Injectable()
export class ChannelRateLimiter {
  private readonly logger = new Logger(ChannelRateLimiter.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CHANNEL_RATE_POLICIES)
    private readonly policies: Record<string, ChannelRatePolicy>,
  ) {}

  policyFor(channel: string): ChannelRatePolicy {
    return this.policies[channel] ?? FALLBACK_POLICY;
  }

  /**
   * Takes `tokens` from the account's bucket. Fails closed: when Redis is not
   * reachable no request may go out, the job is retried later (transient).
   */
  async take(
    channel: string,
    channelAccountId: string,
    tokens = 1,
  ): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
    const policy = this.policyFor(channel);
    const want = Math.min(Math.max(1, Math.floor(tokens)), policy.capacity);
    const ratePerMs = policy.refillPerSecond / 1000;
    const ttlMs = Math.ceil((policy.capacity / ratePerMs) * 2) + 1000;
    let wait: number;
    try {
      wait = (await this.redis.eval(
        TAKE,
        1,
        `sync:rl:${channel}:${channelAccountId}`,
        policy.capacity,
        ratePerMs,
        want,
        ttlMs,
      )) as number;
    } catch {
      this.logger.error('Sync rate limit store unavailable');
      throw new SyncError('SYNC_RATE_LIMIT_UNAVAILABLE', 'transient');
    }
    return wait > 0 ? { ok: false, retryAfterMs: wait } : { ok: true };
  }
}
