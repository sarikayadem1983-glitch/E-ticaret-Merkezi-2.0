/**
 * INT-02 sync engine against the real app, Postgres and Redis (test queues are
 * unique per run). No marketplace is called: handlers are fakes.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { isValidVkn } from './../src/companies/tax-number.js';
import {
  PRISMA,
  type TenantPrismaClient,
} from './../src/database/prisma.service.js';
import { ChannelRateLimiter } from './../src/sync/channel-rate-limiter.js';
import { ExternalRefsRepository } from './../src/sync/external-refs.repository.js';
import { httpFailure, SyncError } from './../src/sync/sync-errors.js';
import { SyncService } from './../src/sync/sync.service.js';
import { jobIdFor, QueueService } from './../src/queue/queue.service.js';
import { UnrecoverableError } from 'bullmq';
import type { SyncContext } from './../src/sync/sync.types.js';
import { TenantContext } from './../src/tenancy/tenant-context.js';
import {
  createTestApp,
  ownerPool,
  purgeTenants,
  seedMember,
  systemRoleId,
} from './helpers.js';

const PASSWORD = 'Correct-Horse-9';
const K1 = randomBytes(32).toString('base64');
const CREDS = {
  supplierId: '987654',
  apiKey: 'ak-sync-abcdefgh-1111',
  apiSecret: 'as-sync-zyxwvuts-2222',
};

function vkn(prefix: string): string {
  const d = '0123456789'.split('').find((c) => isValidVkn(prefix + c));
  if (!d) throw new Error('no check digit');
  return prefix + d;
}
let seq = 0;
const uniqueVkn = () =>
  vkn(String((Date.now() + seq++) % 1e9).padStart(9, '0'));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Sync engine (e2e, INT-02)', () => {
  let app: INestApplication<App>;
  const run = randomUUID().slice(0, 8);
  const slugs = [`sync-a-${run}`, `sync-b-${run}`];
  const kind = (name: string) => `test.e2e-${run}.${name}`;
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let tenantB: string;
  let companyA: string;
  let companyB: string;
  let accountA: string;
  let accountA2: string;
  let accountB: string;
  let sync: SyncService;
  let refs: ExternalRefsRepository;
  let prisma: TenantPrismaClient;
  let queue: QueueService;
  const saved: Record<string, string | undefined> = {};
  const seenCredentials: string[] = [];

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const jobsUrl = (company: string, account: string, rest = '') =>
    `/api/v1/companies/${company}/channel-accounts/${account}/sync-jobs${rest}`;

  const register = async (slug: string) =>
    (
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
  const tenantOf = async (token: string) =>
    (await http().get('/api/v1/auth/me').set(bearer(token))).body.data
      .tenantId as string;
  const company = async (token: string) =>
    (
      await http()
        .post('/api/v1/companies')
        .set(bearer(token))
        .send({
          legalName: `Firma ${run} ${seq}`,
          taxNumber: uniqueVkn(),
          taxOffice: 'Kadıköy',
          addressLine: 'Moda Cad. No: 1',
          district: 'Kadıköy',
          city: 'İstanbul',
        })
        .expect(201)
    ).body.data.id as string;
  const account = async (token: string, companyId: string, name: string) =>
    (
      await http()
        .post(`/api/v1/companies/${companyId}/channel-accounts`)
        .set(bearer(token))
        .send({ channel: 'trendyol', name, credentials: CREDS })
        .expect(201)
    ).body.data.id as string;

  const asA = <T>(fn: () => Promise<T>) => TenantContext.run(tenantA, fn);
  const row = (id: string) =>
    asA(() =>
      prisma.syncJob.findFirstOrThrow({
        where: { id },
        select: {
          status: true,
          attempts: true,
          errorCode: true,
          stats: true,
          payload: true,
        },
      }),
    );
  const waitFor = async (id: string, status: string[], ms = 20_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = await row(id);
      if (status.includes(r.status)) return r;
      if (Date.now() > end) throw new Error(`timeout: ${id} is ${r.status}`);
      await sleep(100);
    }
  };
  const start = (k: string, key: string, payload = {}, acc?: string) =>
    asA(() =>
      sync.startForAccount({
        companyId: companyA,
        channelAccountId: acc ?? accountA,
        kind: k,
        payload,
        idempotencyKey: key,
      }),
    );
  const anyPayload = (raw: unknown) => raw as Record<string, unknown>;

  /** Behaviour per run, keyed by idempotencyKey in the payload. */
  const scripts = new Map<string, ((ctx: SyncContext) => Promise<void>)[]>();
  const scripted =
    () => async (payload: Record<string, unknown>, ctx: SyncContext) => {
      seenCredentials.push(JSON.stringify(ctx.credentials));
      const steps = scripts.get(String(payload.script)) ?? [];
      const step = steps.shift();
      if (step) await step(ctx);
    };

  beforeAll(async () => {
    for (const key of [
      'CHANNEL_KEKS',
      'CHANNEL_KEK_ACTIVE',
      'SYNC_LIVE_CALLS',
    ]) {
      saved[key] = process.env[key];
    }
    process.env.CHANNEL_KEKS = `e2es:${K1}`;
    process.env.CHANNEL_KEK_ACTIVE = 'e2es';
    delete process.env.SYNC_LIVE_CALLS;
    app = await createTestApp();
    sync = app.get(SyncService);
    refs = app.get(ExternalRefsRepository);
    prisma = app.get(PRISMA);
    queue = app.get(QueueService);
    tokenA = await register(slugs[0]);
    tokenB = await register(slugs[1]);
    tenantA = await tenantOf(tokenA);
    tenantB = await tenantOf(tokenB);
    companyA = await company(tokenA);
    companyB = await company(tokenB);
    accountA = await account(tokenA, companyA, 'Ana');
    accountA2 = await account(tokenA, companyA, 'İkinci');
    accountB = await account(tokenB, companyB, 'B');

    const opts = {
      attempts: 3,
      backoffMs: 20,
      parse: anyPayload,
      usesLiveApi: false,
    };
    sync.registerKind(kind('script'), scripted(), opts);
    sync.registerKind(kind('live'), scripted(), { ...opts, usesLiveApi: true });
  });

  afterAll(async () => {
    await app?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await purgeTenants(slugs);
  });

  describe('external refs (no duplicates)', () => {
    const claim = (
      externalId: string,
      hashOf: string,
      at: string | null,
      acc = accountA,
    ) =>
      refs.claim({
        channelAccountId: acc,
        entityType: 'order',
        externalId,
        externalUpdatedAt: at ? new Date(at) : null,
        payloadHash: sha(hashOf),
        syncJobId: randomUUID(),
      });

    it('10 concurrent claims of one order create exactly one row', async () => {
      const results = await asA(() =>
        Promise.all(
          Array.from({ length: 10 }, () =>
            claim('ORD-C', 'v1', '2026-11-13T10:00:00Z'),
          ),
        ),
      );
      expect(results.filter((r) => r.decision === 'created')).toHaveLength(1);
      expect(results.filter((r) => r.decision === 'unchanged')).toHaveLength(9);
      expect(new Set(results.map((r) => r.refId)).size).toBe(1);
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          `SELECT count(*)::int n FROM channel_external_refs WHERE channel_account_id = $1 AND external_id = 'ORD-C'`,
          [accountA],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('newer content updates, older content is stale, same content is unchanged', async () => {
      await asA(async () => {
        expect(
          (await claim('ORD-V', 'v1', '2026-11-13T10:00:00Z')).decision,
        ).toBe('created');
        expect(
          (await claim('ORD-V', 'v1', '2026-11-13T10:00:00Z')).decision,
        ).toBe('unchanged');
        expect(
          (await claim('ORD-V', 'v2', '2026-11-13T11:00:00Z')).decision,
        ).toBe('updated');
        expect(
          (await claim('ORD-V', 'v0', '2026-11-13T09:00:00Z')).decision,
        ).toBe('stale');
        expect((await claim('ORD-V', 'v3', null)).decision).toBe('stale');
        expect((await claim('ORD-N', 'a', null)).decision).toBe('created');
        expect((await claim('ORD-N', 'b', null)).decision).toBe('updated');
      });
    });

    it('the same external id under another account or tenant is a separate record', async () => {
      expect(
        (await asA(() => claim('ORD-X', 'v1', null, accountA2))).decision,
      ).toBe('created');
      expect((await asA(() => claim('ORD-X', 'v1', null))).decision).toBe(
        'created',
      );
      await TenantContext.run(tenantB, async () => {
        expect((await claim('ORD-C', 'v1', null, accountB)).decision).toBe(
          'created',
        );
        // Tenant B cannot see or write tenant A's refs, even with A's account id.
        await expect(claim('ORD-Z', 'v1', null, accountA)).rejects.toThrow();
        expect(
          await prisma.channelExternalRef.count({
            where: { channelAccountId: accountA },
          }),
        ).toBe(0);
      });
    });

    it('concurrent transactional imports link exactly one local record; a crash leaves nothing', async () => {
      const importOnce = (localId: string) =>
        asA(() =>
          prisma.$transaction(async (tx) => {
            const r = await refs.claim(
              {
                channelAccountId: accountA,
                entityType: 'order',
                externalId: 'ORD-TX',
                externalUpdatedAt: null,
                payloadHash: sha('tx'),
                syncJobId: randomUUID(),
              },
              tx,
            );
            if (!r.needsImport) return 'skipped';
            await sleep(50);
            await refs.linkLocal(accountA, r.refId, localId, tx);
            return 'imported';
          }),
        );
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => importOnce(randomUUID())),
      );
      expect(outcomes.filter((o) => o === 'imported')).toHaveLength(1);

      // Crash mid-import: the transaction rolls back, no half-imported ref stays behind.
      await expect(
        asA(() =>
          prisma.$transaction(async (tx) => {
            await refs.claim(
              {
                channelAccountId: accountA,
                entityType: 'order',
                externalId: 'ORD-CRASH',
                externalUpdatedAt: null,
                payloadHash: sha('c'),
                syncJobId: randomUUID(),
              },
              tx,
            );
            throw new Error('process died');
          }),
        ),
      ).rejects.toThrow('process died');
      expect(
        await asA(() =>
          prisma.channelExternalRef.count({
            where: { externalId: 'ORD-CRASH' },
          }),
        ),
      ).toBe(0);
    });
  });

  describe('shared rate limiter', () => {
    it('one bucket per account for every caller; refuses with a wait once spent', async () => {
      const limiter = app.get(ChannelRateLimiter);
      const acc = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 15 }, () => limiter.take('trendyol', acc)),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(10);
      const refused = results.find((r) => !r.ok) as { retryAfterMs: number };
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(1000);
      expect((await limiter.take('trendyol', randomUUID())).ok).toBe(true);
      await sleep(450);
      expect((await limiter.take('trendyol', acc)).ok).toBe(true);
    });
  });

  describe('jobs', () => {
    it('runs in its tenant with decrypted credentials; the same key never makes a second job', async () => {
      scripts.set('ok', [
        async (ctx) => {
          await ctx.takeRate();
          await ctx.claim({
            entityType: 'order',
            externalId: `OK-${run}`,
            externalUpdatedAt: null,
            payloadHash: sha('ok'),
          });
          expect(TenantContext.tenantId()).toBe(tenantA);
          expect(ctx.liveCallsAllowed).toBe(false);
        },
      ]);
      const first = await start(kind('script'), 'k-ok', { script: 'ok' });
      const again = await start(kind('script'), 'k-ok', { script: 'ok' });
      expect(first.duplicate).toBe(false);
      expect(again).toEqual({ syncJobId: first.syncJobId, duplicate: true });
      const done = await waitFor(first.syncJobId, ['succeeded', 'failed']);
      expect(done).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        errorCode: null,
      });
      expect(done.stats).toMatchObject({ processed: 1, created: 1 });
      expect(seenCredentials.some((c) => c === JSON.stringify(CREDS))).toBe(
        true,
      );
      // Starting a finished job's key again does not run it again.
      await start(kind('script'), 'k-ok', { script: 'ok' });
      await sleep(300);
      expect((await row(first.syncJobId)).attempts).toBe(1);
    });

    it('transient failures are retried (bounded) and recover', async () => {
      scripts.set('flaky', [
        async () => {
          throw httpFailure(503);
        },
        async () => undefined,
      ]);
      const { syncJobId } = await start(kind('script'), 'k-flaky', {
        script: 'flaky',
      });
      expect(await waitFor(syncJobId, ['succeeded', 'failed'])).toMatchObject({
        status: 'succeeded',
        attempts: 2,
      });

      scripts.set(
        'down',
        [1, 2, 3].map(() => async () => {
          throw Object.assign(
            new Error(`connect ECONNRESET ${CREDS.apiSecret}`),
            {
              code: 'ECONNRESET',
            },
          );
        }),
      );
      const down = await start(kind('script'), 'k-down', { script: 'down' });
      expect(await waitFor(down.syncJobId, ['failed'])).toMatchObject({
        status: 'failed',
        attempts: 3,
        errorCode: 'NETWORK_ECONNRESET',
      });
    });

    it('auth and validation errors fail at once, without retries', async () => {
      scripts.set('auth', [
        async () => {
          throw httpFailure(401);
        },
      ]);
      scripts.set('bad', [
        async () => {
          throw httpFailure(422);
        },
      ]);
      const auth = await start(kind('script'), 'k-auth', { script: 'auth' });
      const bad = await start(kind('script'), 'k-bad', { script: 'bad' });
      expect(await waitFor(auth.syncJobId, ['failed'])).toMatchObject({
        attempts: 1,
        errorCode: 'CHANNEL_AUTH_FAILED',
      });
      expect(await waitFor(bad.syncJobId, ['failed'])).toMatchObject({
        attempts: 1,
        errorCode: 'CHANNEL_REJECTED_422',
      });
    });

    it('a 429 defers the job (Retry-After) without spending an attempt', async () => {
      scripts.set('429', [
        async () => {
          throw httpFailure(429, '0');
        },
        async () => {
          throw httpFailure(429, '0');
        },
        async () => undefined,
      ]);
      const { syncJobId } = await start(kind('script'), 'k-429', {
        script: '429',
      });
      const done = await waitFor(syncJobId, ['succeeded', 'failed']);
      expect(done).toMatchObject({ status: 'succeeded', attempts: 1 });
    });

    it('live-API kinds are refused while SYNC_LIVE_CALLS is off; inactive accounts never decrypt', async () => {
      const live = await start(kind('live'), 'k-live', { script: 'none' });
      expect(await waitFor(live.syncJobId, ['failed'])).toMatchObject({
        errorCode: 'SYNC_LIVE_CALLS_DISABLED',
      });

      const before = seenCredentials.length;
      const { syncJobId } = await start(
        kind('script'),
        'k-inactive',
        { script: 'none' },
        accountA2,
      );
      // Deactivate the account between enqueue and run is racy; deactivate first instead.
      const pool = ownerPool();
      try {
        await pool.query(
          'UPDATE channel_accounts SET is_active = false WHERE id = $1',
          [accountA2],
        );
        const late = await start(
          kind('script'),
          'k-inactive-2',
          { script: 'none' },
          accountA2,
        );
        expect(await waitFor(late.syncJobId, ['failed'])).toMatchObject({
          errorCode: 'CHANNEL_ACCOUNT_INACTIVE',
        });
        await waitFor(syncJobId, ['succeeded', 'failed']);
      } finally {
        await pool.query(
          'UPDATE channel_accounts SET is_active = true WHERE id = $1',
          [accountA2],
        );
        await pool.end();
      }
      expect(seenCredentials.length - before).toBeLessThanOrEqual(1);
    });

    /** Inserts a row as if the process died at some point; the owner queue job uses `ownerKey`. */
    const insertRow = async (
      status: string,
      idemKey: string,
      ownerKey: string,
      script: string,
    ) => {
      const def = sync.definitionOf(kind('script'));
      if (!def) throw new Error('kind missing');
      const id = randomUUID();
      const pool = ownerPool();
      try {
        await pool.query(
          `INSERT INTO sync_jobs (id, tenant_id, company_id, channel_account_id, kind, status, idempotency_key, payload, attempts, run_token, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
          [
            id,
            tenantA,
            companyA,
            accountA,
            kind('script'),
            status,
            idemKey,
            JSON.stringify({ script }),
            status === 'running' ? 1 : 0,
            jobIdFor(def, tenantA, ownerKey),
          ],
        );
      } finally {
        await pool.end();
      }
      return { id, def };
    };

    it('a crashed "running" row is resumed by its own redelivered queue job, never duplicated', async () => {
      scripts.set('resume', [async () => undefined]);
      const { id, def } = await insertRow(
        'running',
        'k-resume',
        'owner-resume',
        'resume',
      );
      // Same key → existing row, nothing new queued.
      expect(
        await start(kind('script'), 'k-resume', { script: 'resume' }),
      ).toEqual({
        syncJobId: id,
        duplicate: true,
      });
      // Stalled redelivery keeps the owner job id.
      await asA(() =>
        queue.enqueue(
          def,
          { syncJobId: id },
          { idempotencyKey: 'owner-resume' },
        ),
      );
      expect(await waitFor(id, ['succeeded', 'failed'])).toMatchObject({
        status: 'succeeded',
        attempts: 2,
      });
      expect(
        await asA(() =>
          prisma.syncJob.count({ where: { idempotencyKey: 'k-resume' } }),
        ),
      ).toBe(1);
    });

    it('a stray second queue job cannot run a row it does not own; a row without a live job can be retried', async () => {
      let calls = 0;
      scripts.set('orphan', [
        async () => {
          calls += 1;
        },
        async () => {
          calls += 1;
        },
      ]);
      // Process died after inserting the row, before enqueueing its owner job.
      const { id, def } = await insertRow(
        'queued',
        'k-orphan',
        'owner-orphan',
        'orphan',
      );
      await asA(() =>
        queue.enqueue(def, { syncJobId: id }, { idempotencyKey: 'stray' }),
      );
      await sleep(1000);
      expect(calls).toBe(0);
      expect(await row(id)).toMatchObject({ status: 'queued', attempts: 0 });

      await http()
        .post(jobsUrl(companyA, accountA, `/${id}/retry`))
        .set(bearer(tokenA))
        .expect(202);
      expect(await waitFor(id, ['succeeded', 'failed'])).toMatchObject({
        status: 'succeeded',
        attempts: 1,
      });
      expect(calls).toBe(1);
    });

    it('a queue job that dies outside the engine closes its row as abandoned', async () => {
      scripts.set('die', [
        async () => {
          throw new UnrecoverableError('worker gone');
        },
      ]);
      const { syncJobId } = await start(kind('script'), 'k-die', {
        script: 'die',
      });
      expect(await waitFor(syncJobId, ['failed'])).toMatchObject({
        errorCode: 'SYNC_JOB_ABANDONED',
      });
    });

    it('a queued or running job with a live queue job cannot be retried', async () => {
      scripts.set('slow', [
        async () => {
          await sleep(1500);
        },
      ]);
      const { syncJobId } = await start(kind('script'), 'k-slow', {
        script: 'slow',
      });
      await waitFor(syncJobId, ['running']);
      const res = await http()
        .post(jobsUrl(companyA, accountA, `/${syncJobId}/retry`))
        .set(bearer(tokenA))
        .expect(409);
      expect(JSON.stringify(res.body)).toContain('SYNC_JOB_ACTIVE');
      expect(await waitFor(syncJobId, ['succeeded', 'failed'])).toMatchObject({
        status: 'succeeded',
        attempts: 1,
      });
    });

    it('a handler needing more requests than the bucket holds waits in process and keeps its progress', async () => {
      let requests = 0;
      scripts.set('many', [
        async (ctx) => {
          for (let i = 0; i < 25; i++) {
            await ctx.takeRate();
            requests += 1;
          }
        },
      ]);
      const { syncJobId } = await start(
        kind('script'),
        'k-many',
        { script: 'many' },
        accountA2,
      );
      const done = await waitFor(syncJobId, ['succeeded', 'failed'], 30_000);
      expect(done).toMatchObject({ status: 'succeeded', attempts: 1 });
      expect(done.stats).not.toHaveProperty('rateLimitDeferrals');
      expect(requests).toBe(25);
    });

    it('stores codes only: no credentials in rows, errors or logs', async () => {
      const pool = ownerPool();
      try {
        const { rows } = await pool.query(
          `SELECT payload::text p, stats::text s, error_code e FROM sync_jobs WHERE tenant_id = $1`,
          [tenantA],
        );
        const text = JSON.stringify(rows);
        for (const v of [CREDS.apiKey, CREDS.apiSecret])
          expect(text).not.toContain(v);
      } finally {
        await pool.end();
      }
    });
  });

  describe('API', () => {
    let failedId: string;

    beforeAll(async () => {
      scripts.set('api', [
        async () => {
          throw new SyncError('CHANNEL_FORBIDDEN', 'auth');
        },
      ]);
      failedId = (await start(kind('script'), 'k-api', { script: 'api' }))
        .syncJobId;
      await waitFor(failedId, ['failed']);
    });

    it('lists own jobs newest first with Turkish messages and no payload', async () => {
      const res = await http()
        .get(jobsUrl(companyA, accountA))
        .set(bearer(tokenA))
        .expect(200);
      const items = res.body.data as {
        id: string;
        queuedAt: string;
        errorMessage: string | null;
      }[];
      expect(items.length).toBeGreaterThan(3);
      const times = items.map((i) => Date.parse(i.queuedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      for (const item of items) expect(item).not.toHaveProperty('payload');
      expect(items.find((i) => i.id === failedId)?.errorMessage).toMatch(
        /yetki/,
      );

      const failed = await http()
        .get(jobsUrl(companyA, accountA))
        .query({ status: 'failed', limit: 2 })
        .set(bearer(tokenA))
        .expect(200);
      expect(failed.body.data).toHaveLength(2);
      expect(failed.body.nextCursor).toEqual(expect.any(String));
      for (const item of failed.body.data) expect(item.status).toBe('failed');
      const next = await http()
        .get(jobsUrl(companyA, accountA))
        .query({ status: 'failed', limit: 2, cursor: failed.body.nextCursor })
        .set(bearer(tokenA))
        .expect(200);
      const ids = new Set(failed.body.data.map((i: { id: string }) => i.id));
      for (const item of next.body.data) expect(ids.has(item.id)).toBe(false);
    });

    it('another tenant gets 404 for the account and its jobs; bad input is rejected', async () => {
      await http()
        .get(jobsUrl(companyA, accountA))
        .set(bearer(tokenB))
        .expect(404);
      await http()
        .post(jobsUrl(companyA, accountA, `/${failedId}/retry`))
        .set(bearer(tokenB))
        .expect(404);
      // B's own account, A's job id: not found either.
      await http()
        .post(jobsUrl(companyB, accountB, `/${failedId}/retry`))
        .set(bearer(tokenB))
        .expect(404);
      await http()
        .get(jobsUrl(companyA, accountA))
        .query({ status: 'done' })
        .set(bearer(tokenA))
        .expect(422);
      // A cursor from another account's log is refused, not used as a position.
      await http()
        .get(jobsUrl(companyA, accountA2))
        .query({ cursor: failedId })
        .set(bearer(tokenA))
        .expect(422);
    });

    it('a company-scoped operator without channels:manage gets 403', async () => {
      const email = `sync-op-${run}@test.local`;
      const userId = await seedMember({
        email,
        name: 'Operasyon',
        passwordHash: await hash(PASSWORD),
        lastTenantId: tenantA,
        memberships: [{ tenantId: tenantA }],
      });
      const pool = ownerPool();
      try {
        await pool.query(
          `INSERT INTO user_company_roles (tenant_id, user_id, company_id, role_id) VALUES ($1, $2, $3, $4)`,
          [
            tenantA,
            userId,
            companyA,
            await systemRoleId(tenantA, 'operations'),
          ],
        );
      } finally {
        await pool.end();
      }
      const token = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.data.accessToken as string;
      await http()
        .get(jobsUrl(companyA, accountA))
        .set(bearer(token))
        .expect(403);
      await http()
        .post(jobsUrl(companyA, accountA, `/${failedId}/retry`))
        .set(bearer(token))
        .expect(403);
    });

    it('retry: concurrent requests start the job once; finished or running jobs cannot be retried', async () => {
      scripts.set('api', [async () => undefined]);
      const [r1, r2] = await Promise.all([
        http()
          .post(jobsUrl(companyA, accountA, `/${failedId}/retry`))
          .set(bearer(tokenA)),
        http()
          .post(jobsUrl(companyA, accountA, `/${failedId}/retry`))
          .set(bearer(tokenA)),
      ]);
      expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([202, 409]);
      expect(await waitFor(failedId, ['succeeded', 'failed'])).toMatchObject({
        status: 'succeeded',
      });
      const again = await http()
        .post(jobsUrl(companyA, accountA, `/${failedId}/retry`))
        .set(bearer(tokenA))
        .expect(409);
      expect(again.body.error?.code ?? again.body.code).toBe(
        'SYNC_JOB_NOT_FAILED',
      );
    });
  });
});
