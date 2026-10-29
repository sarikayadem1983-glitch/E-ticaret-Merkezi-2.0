import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import { QUEUE_PREFIX } from './../src/queue/queue.connection.js';
import { QueueService } from './../src/queue/queue.service.js';
import { defineJob, type JobContext } from './../src/queue/queue.types.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import { TenantsService } from './../src/tenants/tenants.service.js';
import { createTestApp, ownerPool, purgeTenants } from './helpers.js';

const PASSWORD = 'Correct-Horse-9';

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}

/** Polls until check() is truthy; fails after timeoutMs. */
async function until<T>(check: () => Promise<T> | T, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Queue (e2e)', () => {
  let app: INestApplication<App>;
  let queue: QueueService;
  let prisma: TenantPrismaClient;
  const run = randomUUID().slice(0, 8);
  const slugs = [`q-a-${run}`, `q-b-${run}`, `q-off-${run}`];
  const tenants: string[] = [];
  /** Unique per run so leftovers from a previous run cannot dedupe our jobs. */
  const qn = (s: string) => `test.${s}.${run}`;

  const http = () => request(app.getHttpServer());

  async function register(slug: string, companies: number) {
    const token = (
      await http()
        .post('/api/v1/auth/register')
        .send({
          tenantName: `Mağaza ${slug}`,
          tenantSlug: slug,
          name: 'Sahip',
          email: `${slug}@test.local`,
          password: PASSWORD,
        })
        .expect(201)
    ).body.data.accessToken as string;
    for (let i = 0; i < companies; i++) {
      await http()
        .post('/api/v1/companies')
        .set({ Authorization: `Bearer ${token}` })
        .send({
          legalName: `Firma ${i}`,
          taxNumber: vkn(
            String(Date.now() % 1e6).padStart(6, '0') +
              String(tenants.length * 10 + i).padStart(3, '0'),
          ),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201);
    }
    const me = await http()
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${token}` });
    return me.body.data.tenantId as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(QueueService);
    prisma = app.get(PRISMA);
    tenants.push(await register(slugs[0], 2));
    tenants.push(await register(slugs[1], 1));
    tenants.push(await register(slugs[2], 0));
    const pool = ownerPool();
    await pool.query('UPDATE tenants SET is_active = false WHERE id = $1', [
      tenants[2],
    ]);
    await pool.end();
  });

  afterAll(async () => {
    await app?.close();
    await purgeTenants(slugs);
  });

  const asTenant = <T>(i: number, fn: () => T) =>
    TenantContext.run(tenants[i], fn);

  it('runs the handler in the job tenant: scoped queries see only its rows', async () => {
    const def = defineJob<{ tag: string }>({ name: qn('scope') });
    const seen = new Map<
      string,
      { ctx: JobContext; companyTenants: string[] }
    >();
    queue.register(def, async (payload, ctx) => {
      const rows = await prisma.company.findMany({
        select: { tenantId: true },
      });
      seen.set(payload.tag, {
        ctx,
        companyTenants: rows.map((r) => r.tenantId),
      });
    });

    await asTenant(0, () =>
      queue.enqueue(def, { tag: 'a' }, { idempotencyKey: 'a' }),
    );
    await asTenant(1, () =>
      queue.enqueue(def, { tag: 'b' }, { idempotencyKey: 'b' }),
    );
    await until(() => seen.size === 2);

    expect(seen.get('a')!.ctx.tenantId).toBe(tenants[0]);
    expect(seen.get('a')!.companyTenants).toEqual([tenants[0], tenants[0]]);
    expect(seen.get('b')!.ctx.tenantId).toBe(tenants[1]);
    expect(seen.get('b')!.companyTenants).toEqual([tenants[1]]);
  });

  it('refuses to enqueue without a tenant context', async () => {
    const def = defineJob<object>({ name: qn('noctx') });
    await expect(
      queue.enqueue(def, {}, { idempotencyKey: 'x' }),
    ).rejects.toThrow(/TENANT|Tenant/);
    await expect(
      TenantContext.runAsSystem(() =>
        queue.enqueue(def, {}, { idempotencyKey: 'x' }),
      ),
    ).rejects.toThrow();
  });

  describe('jobs with an invalid tenant are refused and dead-lettered', () => {
    const def = defineJob<object>({
      name: qn('badtenant'),
      attempts: 3,
      backoffMs: 10,
    });
    const handler = vi.fn(async () => {});

    let raw: Queue;
    beforeAll(() => {
      queue.register(def, handler);
      raw = new Queue(def.name, {
        connection: { url: process.env.REDIS_URL },
        prefix: QUEUE_PREFIX,
      });
    });
    afterAll(() => raw.close());

    it.each([
      ['missing', { payload: {} }],
      ['malformed', { tenantId: 'nope', payload: {} }],
      ['unknown', { tenantId: randomUUID(), payload: {} }],
    ])('%s tenantId', async (label, data) => {
      // Bypasses enqueue (which always stamps the context tenant) to simulate a
      // forged or corrupted job written straight to Redis.
      const added = await raw.add(def.name, data, {
        jobId: `raw-${label}`,
        attempts: 3,
      });
      // State first, then the job: a job read before the state check may be stale.
      await until(async () => (await raw.getJobState(added.id!)) === 'failed');
      const job = await raw.getJob(added.id!);
      expect(job!.attemptsMade).toBe(1);
      expect(job!.failedReason).toBe('INVALID_JOB_TENANT');
      expect(handler).not.toHaveBeenCalled();
    });

    it('inactive tenant', async () => {
      await asTenant(2, () =>
        queue.enqueue(def, {}, { idempotencyKey: 'off' }),
      );
      const dead = await until(async () => {
        const { items } = await asTenant(2, () => queue.deadLetters(def));
        return items.length ? items : undefined;
      });
      expect(dead[0]).toMatchObject({
        tenantId: tenants[2],
        attemptsMade: 1,
        errorCode: 'INVALID_JOB_TENANT',
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it('retries with exponential backoff, then dead-letters after max attempts', async () => {
    const def = defineJob<object>({
      name: qn('retry'),
      attempts: 3,
      backoffMs: 200,
    });
    const runs: { attempt: number; at: number }[] = [];
    queue.register(def, async (_p, ctx) => {
      runs.push({ attempt: ctx.attempt, at: Date.now() });
      throw new Error('token=secret-should-not-be-logged');
    });

    await asTenant(0, () => queue.enqueue(def, {}, { idempotencyKey: 'r1' }));
    const dead = await until(async () => {
      const { items } = await asTenant(0, () => queue.deadLetters(def));
      return items.length ? items : undefined;
    }, 15_000);

    expect(runs.map((r) => r.attempt)).toEqual([1, 2, 3]);
    // Exponential: ~200 ms before the 2nd run, ~400 ms before the 3rd.
    expect(runs[1].at - runs[0].at).toBeGreaterThanOrEqual(180);
    expect(runs[2].at - runs[1].at).toBeGreaterThanOrEqual(380);
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      tenantId: tenants[0],
      attemptsMade: 3,
      errorCode: 'JOB_FAILED:Error',
    });

    // Redis keeps only the code: no handler message, no stack trace.
    const redis = new Redis(process.env.REDIS_URL!);
    const stored = await redis.hgetall(
      `${QUEUE_PREFIX}:${def.name}:${dead[0].id}`,
    );
    await redis.quit();
    expect(stored.failedReason).toBe('JOB_FAILED:Error');
    expect(JSON.stringify(stored)).not.toContain('secret-should-not');
    expect(JSON.parse(stored.stacktrace ?? '[]')).toEqual([]);

    // Other tenants cannot see it.
    expect(await asTenant(1, () => queue.deadLetters(def))).toEqual({
      items: [],
      nextCursor: undefined,
    });

    // A dead letter can be retried by its own tenant.
    await expect(
      asTenant(1, () => queue.retryDeadLetter(def, dead[0].id)),
    ).resolves.toBe(false);
    await expect(
      asTenant(0, () => queue.retryDeadLetter(def, dead[0].id)),
    ).resolves.toBe(true);
    await until(() => runs.length === 4);
  });

  it('runs a duplicate idempotency key once', async () => {
    const def = defineJob<{ n: number }>({ name: qn('idem') });
    const runs: number[] = [];
    queue.register(def, async (p) => {
      runs.push(p.n);
    });

    const first = await asTenant(0, () =>
      queue.enqueue(def, { n: 1 }, { idempotencyKey: 'order-42' }),
    );
    const second = await asTenant(0, () =>
      queue.enqueue(def, { n: 2 }, { idempotencyKey: 'order-42' }),
    );
    await until(() => runs.length === 1);
    // Same key after completion is still a duplicate (kept for the retention window).
    const third = await asTenant(0, () =>
      queue.enqueue(def, { n: 3 }, { idempotencyKey: 'order-42' }),
    );
    // Same key in another tenant is a different job.
    const other = await asTenant(1, () =>
      queue.enqueue(def, { n: 4 }, { idempotencyKey: 'order-42' }),
    );
    await until(() => runs.length === 2);
    await new Promise((r) => setTimeout(r, 300));

    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ jobId: first.jobId, duplicate: true });
    expect(third).toEqual({ jobId: first.jobId, duplicate: true });
    expect(other.duplicate).toBe(false);
    expect(runs).toEqual([1, 4]);
  });

  it('reports health and exposes it on /health', async () => {
    await expect(queue.health()).resolves.toBe('up');
    await http()
      .get('/api/v1/health')
      .expect(200)
      .expect({ data: { status: 'ok', database: 'up', queue: 'up' } });
  });

  it('keeps no job data under keys of other prefixes', async () => {
    const redis = new Redis(process.env.REDIS_URL!);
    const keys = await redis.keys(`*${qn('idem')}*`);
    await redis.quit();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith('queue:'))).toBe(true);
  });

  it("one tenant's mass failures do not change another's dead letters", async () => {
    const def = defineJob<{ n: number }>({ name: qn('mass'), attempts: 1 });
    queue.register(def, async () => {
      throw new Error('boom');
    });
    const raw = new Queue(def.name, {
      connection: { url: process.env.REDIS_URL },
      prefix: QUEUE_PREFIX,
    });
    // 300 failures for tenant 0 written in bulk, 2 for tenant 1.
    await raw.addBulk(
      Array.from({ length: 300 }, (_, n) => ({
        name: def.name,
        data: { tenantId: tenants[0], payload: { n } },
        opts: { attempts: 1, stackTraceLimit: 0 },
      })),
    );
    await asTenant(1, () =>
      queue.enqueue(def, { n: -1 }, { idempotencyKey: 'm1' }),
    );
    await asTenant(1, () =>
      queue.enqueue(def, { n: -2 }, { idempotencyKey: 'm2' }),
    );
    await until(async () => (await raw.getFailedCount()) === 302, 30_000);
    await raw.close();

    const b = await asTenant(1, () => queue.deadLetters(def));
    expect(b.items.map((d) => d.payload?.n ?? 0).sort((x, y) => x - y)).toEqual(
      [-2, -1],
    );
    expect(b.nextCursor).toBeUndefined();

    const a = await asTenant(0, () => queue.deadLetters(def, { limit: 100 }));
    expect(a.items).toHaveLength(100);
    expect(a.nextCursor).toBeDefined();
    expect(a.items.every((d) => d.tenantId === tenants[0])).toBe(true);
  }, 40_000);

  it('a hung handler does not block shutdown beyond QUEUE_SHUTDOWN_TIMEOUT_MS', async () => {
    const config = app.get(ConfigService);
    const own = new QueueService(
      {
        get: (k: string) =>
          k === 'QUEUE_SHUTDOWN_TIMEOUT_MS' ? '500' : config.get(k),
      } as unknown as ConfigService,
      prisma,
      app.get(TenantsService),
    );
    await own.onModuleInit();
    const def = defineJob<object>({ name: qn('hung') });
    let started = false;
    own.register(def, async () => {
      started = true;
      await new Promise(() => undefined);
    });
    await asTenant(0, () => own.enqueue(def, {}, { idempotencyKey: 'h' }));
    await until(() => started);
    const t0 = Date.now();
    await own.onApplicationShutdown();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  // Last: shuts the queue down.
  it('graceful shutdown lets the active job finish and then refuses enqueue', async () => {
    const def = defineJob<object>({ name: qn('shutdown') });
    let started = false;
    let finished = false;
    queue.register(def, async () => {
      started = true;
      await new Promise((r) => setTimeout(r, 500));
      finished = true;
    });
    await asTenant(0, () => queue.enqueue(def, {}, { idempotencyKey: 's' }));
    await until(() => started);
    await queue.onApplicationShutdown();
    expect(finished).toBe(true);
    await expect(
      asTenant(0, () => queue.enqueue(def, {}, { idempotencyKey: 's2' })),
    ).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
  });
});

describe('Queue with Redis down (e2e)', () => {
  let app: INestApplication<App>;
  const previous = process.env.REDIS_URL;

  beforeAll(async () => {
    // Nothing listens on port 1: the whole app boots against a dead Redis.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    process.env.REDIS_URL = previous;
  });

  it('enqueue fails fast with QUEUE_UNAVAILABLE, no hang', async () => {
    const queue = app.get(QueueService);
    const def = defineJob<object>({ name: 'test.dead-redis' });
    const t0 = Date.now();
    await expect(
      TenantContext.run(randomUUID(), () =>
        queue.enqueue(def, {}, { idempotencyKey: 'k' }),
      ),
    ).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('health shows the queue down but stays 200', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ data: { status: 'ok', database: 'up', queue: 'down' } });
  });
});
