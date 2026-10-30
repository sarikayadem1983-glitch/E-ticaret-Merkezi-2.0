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
    expect((error as Error).message).toBe('INVALID_JOB_TENANT');
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
    expect((error as Error).message).toBe('INVALID_JOB_TENANT');
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
    expect((error as Error).message).toBe('INVALID_JOB_PAYLOAD');
    expect(handler).not.toHaveBeenCalled();
  });

  const fail = (thrown: unknown) =>
    runJob(
      def,
      async () => {
        throw thrown;
      },
      { tenantId: TENANT, payload: {} },
      meta,
      active,
    ).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error,
    );

  it('rethrows handler errors as retryable, keeping only a code', async () => {
    const error = await fail(new Error('token=abc marketplace timeout'));
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('JOB_FAILED:Error');
    expect(error.stack).toBe('');
    expect(JSON.stringify(error)).not.toContain('abc');
  });

  it('uses a safe error code from the handler error', async () => {
    const coded = Object.assign(new Error('secret'), { code: 'ETIMEDOUT' });
    expect((await fail(coded)).message).toBe('JOB_FAILED:ETIMEDOUT');
    const unsafe = Object.assign(new Error('x'), { code: 'pw hunter2' });
    expect((await fail(unsafe)).message).toBe('JOB_FAILED:Error');
    expect((await fail('plain string')).message).toBe('JOB_FAILED:UNKNOWN');
  });

  it('keeps a handler UnrecoverableError unrecoverable, without its message', async () => {
    const error = await fail(new UnrecoverableError('password=x'));
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.message).toBe('JOB_FAILED:UNRECOVERABLE');
  });

  it('stores only the code for refusals', async () => {
    const error = await runJob(def, async () => {}, {}, meta, active).then(
      () => new Error('resolved'),
      (e: unknown) => e as Error,
    );
    expect(error.message).toBe('INVALID_JOB_TENANT');
    expect(error.stack).toBe('');
  });
});

describe('defineJob', () => {
  it.each(['Bad', 'a:b', '', 'x y'])('rejects the name %j', (name) => {
    expect(() => defineJob({ name })).toThrow();
  });
});
