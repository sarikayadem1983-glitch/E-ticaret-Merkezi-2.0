import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Redis } from 'ioredis';
import request from 'supertest';
import {
  type AuthRateLimits,
  DEFAULT_AUTH_RATE_LIMITS,
} from './../src/rate-limit/rate-limit.config.js';
import { REDIS } from './../src/rate-limit/redis.provider.js';
import { createTestApp, purgeTenants } from './helpers.js';

const MINUTE = 60_000;
const PASSWORD = 'Correct-Horse-9';
const WRONG = 'Wrong-Password-9';

/** Small limits so each rule is reached in a few requests. */
const TIGHT: AuthRateLimits = {
  ...DEFAULT_AUTH_RATE_LIMITS,
  loginPerIp: { limit: 6, windowMs: 15 * MINUTE },
  loginPerAccountIp: {
    free: 2,
    baseMs: MINUTE,
    maxMs: 15 * MINUTE,
    windowMs: 60 * MINUTE,
  },
  loginPerAccount: {
    free: 4,
    baseMs: MINUTE,
    maxMs: 15 * MINUTE,
    windowMs: 60 * MINUTE,
  },
  registerPerIp: { limit: 2, windowMs: 60 * MINUTE },
  refreshPerIp: { limit: 3, windowMs: MINUTE },
};

const run = randomUUID().slice(0, 8);
let ipSeq = 0;
/** A fresh documentation-range address per call, so tests never share an IP bucket. */
const nextIp = () => `198.51.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

async function clearRateLimits() {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

describe('Auth rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  const slugs: string[] = [];

  const login = (ip: string, email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });

  async function registerUser(): Promise<string> {
    const slug = `rl-${run}-${slugs.length}`;
    slugs.push(slug);
    const email = `${slug}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send({
        tenantName: 'Rate Limit Test',
        tenantSlug: slug,
        name: 'Test User',
        email,
        password: PASSWORD,
      })
      .expect(201);
    return email;
  }

  function expectThrottled(res: request.Response, maxSeconds: number) {
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin',
        details: [],
      },
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(maxSeconds);
  }

  beforeAll(async () => {
    await clearRateLimits();
    app = await createTestApp(
      { TRUST_PROXY: 'loopback' },
      { rateLimits: TIGHT },
    );
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
    await clearRateLimits();
  });

  describe('login per account + IP', () => {
    it('backs off after the free attempts, with Retry-After', async () => {
      const email = await registerUser();
      const ip = nextIp();
      await login(ip, email, WRONG).expect(401);
      await login(ip, email, WRONG).expect(401);
      expectThrottled(await login(ip, email, WRONG), 60);
      // The correct password is throttled too: the check runs before verification.
      expectThrottled(await login(ip, email, PASSWORD), 60);
    });

    it('gives an unknown email exactly the same responses (no user enumeration)', async () => {
      const ip = nextIp();
      const ghost = `ghost-${run}@example.com`;
      const first = await login(ip, ghost, WRONG).expect(401);
      expect(first.body.error.code).toBe('INVALID_CREDENTIALS');
      await login(ip, ghost, WRONG).expect(401);
      expectThrottled(await login(ip, ghost, WRONG), 60);
    });

    it('does not throttle the same account from another IP', async () => {
      const email = await registerUser();
      const attacker = nextIp();
      await login(attacker, email, WRONG).expect(401);
      await login(attacker, email, WRONG).expect(401);
      await login(attacker, email, WRONG).expect(429);
      await login(nextIp(), email, PASSWORD).expect(200);
    });

    it('clears the counter after a successful login', async () => {
      const email = await registerUser();
      const ip = nextIp();
      await login(ip, email, WRONG).expect(401);
      await login(ip, email, PASSWORD).expect(200);
      await login(ip, email, WRONG).expect(401);
      await login(ip, email, WRONG).expect(401);
      await login(ip, email, WRONG).expect(429);
    });
  });

  describe('login per account (all IPs)', () => {
    it('slows distributed guessing but never locks out a trusted IP', async () => {
      const email = await registerUser();
      const owner = nextIp();
      await login(owner, email, PASSWORD).expect(200);

      for (let i = 0; i < 2; i++) {
        const ip = nextIp();
        await login(ip, email, WRONG).expect(401);
        await login(ip, email, WRONG).expect(401);
      }
      expectThrottled(await login(nextIp(), email, WRONG), 60);
      await login(owner, email, PASSWORD).expect(200);
    });
  });

  describe('login per IP', () => {
    it('caps attempts across many accounts (credential stuffing)', async () => {
      const ip = nextIp();
      for (let i = 0; i < 6; i++) {
        await login(ip, `stuff-${run}-${i}@example.com`, WRONG).expect(401);
      }
      expectThrottled(
        await login(ip, `stuff-${run}-x@example.com`, WRONG),
        15 * 60,
      );
    });
  });

  it('limits registrations per IP', async () => {
    const ip = nextIp();
    const send = (n: number) => {
      const slug = `rl-${run}-reg-${n}`;
      slugs.push(slug);
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', ip)
        .send({
          tenantName: 'Spam',
          tenantSlug: slug,
          name: 'Spam',
          email: `${slug}@example.com`,
          password: PASSWORD,
        });
    };
    await send(0).expect(201);
    await send(1).expect(201);
    expectThrottled(await send(2), 60 * 60);
  });

  it('limits refresh calls per IP', async () => {
    const ip = nextIp();
    const refresh = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('X-Forwarded-For', ip)
        .send({ refreshToken: 'x'.repeat(43) });
    for (let i = 0; i < 3; i++) await refresh().expect(401);
    expectThrottled(await refresh(), 60);
  });

  it('ignores X-Forwarded-For from untrusted peers', async () => {
    // Asserts on the stored buckets: other e2e suites share the loopback
    // per-IP counter in parallel, so counting responses would be flaky.
    const untrusted = await createTestApp({}, { rateLimits: TIGHT });
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      const spoofed = nextIp();
      const res = await request(untrusted.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', spoofed)
        .send({ email: `spoof-${run}@example.com`, password: WRONG });
      // 429 if the shared loopback bucket is already full; either way it was counted there.
      expect([401, 429]).toContain(res.status);
      expect(await redis.exists(`rl:login:ip:${spoofed}`)).toBe(0);
      // No assertion on the loopback bucket itself: parallel suites create it
      // with a short window, so it can expire between the request and the check.
    } finally {
      redis.disconnect();
      await untrusted.close();
    }
  });
});

describe('Auth rate limiting with Redis down (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const deadRedis = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    app = await createTestApp(
      {},
      {
        rateLimits: TIGHT,
        providers: [{ provide: REDIS, useValue: deadRedis }],
      },
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['login', { email: 'down@example.com', password: WRONG }],
    [
      'register',
      {
        tenantName: 'Down',
        tenantSlug: `rl-${run}-down`,
        name: 'Down',
        email: `down-${run}@example.com`,
        password: PASSWORD,
      },
    ],
    ['refresh', { refreshToken: 'x'.repeat(43) }],
  ])('fails closed on %s with 503 and Retry-After', async (path, body) => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/auth/${path}`)
      .send(body);
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/redis|ECONNREFUSED|stream/i);
  });

  it('switch-tenant/abort does not depend on Redis (INF-18)', async () => {
    // Unknown tokens: 401 from the database check, not 503 from the limiter.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/switch-tenant/abort')
      .send({
        refreshToken: 'x'.repeat(43),
        previousRefreshToken: 'y'.repeat(43),
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('keeps unrelated endpoints working', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
