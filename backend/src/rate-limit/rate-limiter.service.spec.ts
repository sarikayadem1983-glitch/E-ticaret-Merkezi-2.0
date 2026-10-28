import type { Redis } from 'ioredis';
import {
  RateLimitedException,
  RateLimitUnavailableException,
} from './rate-limit.errors.js';
import { RateLimiterService } from './rate-limiter.service.js';

const POLICY = { limit: 2, windowMs: 60_000 };
const BACKOFF = { free: 1, baseMs: 1000, maxMs: 10_000, windowMs: 60_000 };

function serviceWith(redis: Partial<Record<keyof Redis, unknown>>) {
  return new RateLimiterService(redis as unknown as Redis);
}

describe('RateLimiterService', () => {
  it('allows hits up to the limit', async () => {
    const service = serviceWith({ eval: vi.fn().mockResolvedValue([2, 5000]) });
    await expect(service.hit('k', POLICY)).resolves.toBeUndefined();
  });

  it('throws 429 with the remaining window as Retry-After', async () => {
    const service = serviceWith({ eval: vi.fn().mockResolvedValue([3, 4200]) });
    const error = await service.hit('k', POLICY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedException);
    expect((error as RateLimitedException).getResponse()).toMatchObject({
      retryAfter: 5,
    });
  });

  it('throws 429 when a backoff key is still waiting', async () => {
    const service = serviceWith({ eval: vi.fn().mockResolvedValue(1500) });
    await expect(
      service.attempt([{ key: 'a', policy: BACKOFF }]),
    ).rejects.toBeInstanceOf(RateLimitedException);
  });

  it('prefixes keys and passes every policy to one atomic script', async () => {
    const evalFn = vi.fn().mockResolvedValue(0);
    await serviceWith({ eval: evalFn }).attempt([
      { key: 'a', policy: BACKOFF },
      { key: 'b', policy: { ...BACKOFF, free: 5 } },
    ]);
    expect(evalFn).toHaveBeenCalledTimes(1);
    expect(evalFn.mock.calls[0].slice(1)).toEqual([
      2,
      'rl:a',
      'rl:b',
      1,
      1000,
      10_000,
      60_000,
      5,
      1000,
      10_000,
      60_000,
    ]);
  });

  it.each([
    ['hit', (s: RateLimiterService) => s.hit('k', POLICY)],
    [
      'attempt',
      (s: RateLimiterService) => s.attempt([{ key: 'k', policy: BACKOFF }]),
    ],
    ['reset', (s: RateLimiterService) => s.reset('k')],
    ['mark', (s: RateLimiterService) => s.mark('k', 1000)],
    ['isMarked', (s: RateLimiterService) => s.isMarked('k')],
  ])('fails closed when Redis errors (%s)', async (_name, call) => {
    const down = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const service = serviceWith({
      eval: down,
      del: down,
      set: down,
      exists: down,
    });
    await expect(call(service)).rejects.toBeInstanceOf(
      RateLimitUnavailableException,
    );
  });
});
