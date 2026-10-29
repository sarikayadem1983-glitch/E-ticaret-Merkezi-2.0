import { UnrecoverableError } from 'bullmq';
import { TenantContext } from '../tenancy/tenant-context.js';
import { runJob } from './job-runner.js';
import { defineJob } from './queue.types.js';

const TENANT = '7f1c6d1e-2b7a-4c5e-9f00-0a1b2c3d4e5f';
const meta = { jobId: 'j1', attempt: 1 };
const def = defineJob<{ n: number }>({ name: 'test.runner' });

describe('runJob', () => {
  const active = { isTenantActive: vi.fn(async () => true) };

  it('runs the handler inside the job tenant context', async () => {
    const seen: unknown[] = [];
    await runJob(
      def,
      async (payload, ctx) => {
        seen.push(
          TenantContext.tenantId(),
          TenantContext.isSystem(),
          payload,
          ctx,
        );
      },
      { tenantId: TENANT, payload: { n: 1 } },
      meta,
      active,
    );
    expect(seen).toEqual([
      TENANT,
      false,
      { n: 1 },
      { jobId: 'j1', attempt: 1, tenantId: TENANT },
    ]);
  });

  it('checks the tenant inside its own context', async () => {
    const isTenantActive = vi.fn(
      async () => TenantContext.tenantId() === TENANT,
    );
    await runJob(def, async () => {}, { tenantId: TENANT, payload: {} }, meta, {
      isTenantActive,
    });
    expect(isTenantActive).toHaveBeenCalledWith(TENANT);
  });

  it.each([
    ['missing', { payload: {} }],
    ['empty', { tenantId: '', payload: {} }],
    ['malformed', { tenantId: 'not-a-uuid', payload: {} }],
    ['non-string', { tenantId: 42, payload: {} }],
    ['no envelope', undefined],
  ])('refuses a %s tenant without running the handler', async (_, data) => {
    const handler = vi.fn(async () => {});
    const error = await runJob(def, handler, data, meta, active).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toMatch(/^INVALID_JOB_TENANT/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses an unknown or inactive tenant', async () => {
    const handler = vi.fn(async () => {});
    const error = await runJob(
      def,
      handler,
      { tenantId: TENANT, payload: {} },
      meta,
      {
        isTenantActive: async () => false,
      },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toMatch(/^INVALID_JOB_TENANT/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a payload that fails parse', async () => {
    const strict = defineJob<{ n: number }>({
      name: 'test.strict',
      parse: (raw) => {
        if (typeof (raw as { n?: unknown }).n !== 'number')
          throw new Error('bad');
        return raw as { n: number };
      },
    });
    const handler = vi.fn(async () => {});
    const error = await runJob(
      strict,
      handler,
      { tenantId: TENANT, payload: { n: 'x' } },
      meta,
      active,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toMatch(/^INVALID_JOB_PAYLOAD/);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rethrows handler errors as retryable', async () => {
    const error = await runJob(
      def,
      async () => {
        throw new Error('marketplace timeout');
      },
      { tenantId: TENANT, payload: {} },
      meta,
      active,
    ).catch((e) => e);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe('marketplace timeout');
  });
});

describe('defineJob', () => {
  it.each(['Bad', 'a:b', '', 'x y'])('rejects the name %j', (name) => {
    expect(() => defineJob({ name })).toThrow();
  });
});
