import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { BackoffPolicy, FixedWindowPolicy } from './rate-limit.config.js';
import {
  RateLimitedException,
  RateLimitUnavailableException,
} from './rate-limit.errors.js';
import { REDIS } from './redis.provider.js';

const PREFIX = 'rl:';

// Returns { count, pttl }. The expiry is set on the first hit (or repaired if missing).
const FIXED_WINDOW = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}`;

// KEYS: backoff hashes. ARGV: 4 numbers per key (free, baseMs, maxMs, windowMs).
// Checks every key first and consumes an attempt on all of them only if none
// is blocked, so a rejected request never extends the block. Returns wait ms (0 = allowed).
// Uses the Redis clock so every app instance agrees on time.
const BACKOFF = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local wait = 0
for i, key in ipairs(KEYS) do
  local o = (i - 1) * 4
  local free, base, max = tonumber(ARGV[o + 1]), tonumber(ARGV[o + 2]), tonumber(ARGV[o + 3])
  local count = tonumber(redis.call('HGET', key, 'c') or '0')
  if count >= free then
    local last = tonumber(redis.call('HGET', key, 'l') or '0')
    local delay = math.min(base * math.pow(2, count - free), max)
    wait = math.max(wait, last + delay - now)
  end
end
if wait > 0 then return wait end
for i, key in ipairs(KEYS) do
  redis.call('HINCRBY', key, 'c', 1)
  redis.call('HSET', key, 'l', now)
  redis.call('PEXPIRE', key, ARGV[(i - 1) * 4 + 4])
end
return 0`;

/**
 * Distributed rate limiting on Redis. Every operation is one atomic script, so
 * concurrent requests on several app instances cannot slip past a limit.
 * Any Redis failure throws RateLimitUnavailableException (fail closed).
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts the request; throws 429 once the window's limit is exceeded. */
  async hit(key: string, policy: FixedWindowPolicy): Promise<void> {
    const [count, ttl] = await this.run(
      () =>
        this.redis.eval(
          FIXED_WINDOW,
          1,
          PREFIX + key,
          policy.windowMs,
        ) as Promise<[number, number]>,
    );
    if (count > policy.limit) throw new RateLimitedException(ttl);
  }

  /** Consumes one attempt on every key, or throws 429 if any of them is in backoff. */
  async attempt(
    entries: { key: string; policy: BackoffPolicy }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const args = entries.flatMap(({ policy: p }) => [
      p.free,
      p.baseMs,
      p.maxMs,
      p.windowMs,
    ]);
    const wait = await this.run(
      () =>
        this.redis.eval(
          BACKOFF,
          entries.length,
          ...entries.map((e) => PREFIX + e.key),
          ...args,
        ) as Promise<number>,
    );
    if (wait > 0) throw new RateLimitedException(wait);
  }

  async reset(...keys: string[]): Promise<void> {
    await this.run(() => this.redis.del(...keys.map((k) => PREFIX + k)));
  }

  async mark(key: string, ttlMs: number): Promise<void> {
    await this.run(() => this.redis.set(PREFIX + key, '1', 'PX', ttlMs));
  }

  async isMarked(key: string): Promise<boolean> {
    return (await this.run(() => this.redis.exists(PREFIX + key))) === 1;
  }

  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error) {
      this.logger.error(
        `Rate limit store unavailable: ${(error as Error).message}`,
      );
      throw new RateLimitUnavailableException();
    }
  }
}
