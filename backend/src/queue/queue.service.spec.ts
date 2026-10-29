import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import type { TenantPrismaClient } from '../database/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import { QueueUnavailableError } from './queue.errors.js';
import { errorCode, jobIdFor, QueueService } from './queue.service.js';
import { defineJob } from './queue.types.js';

const TENANT = '7f1c6d1e-2b7a-4c5e-9f00-0a1b2c3d4e5f';
const def = defineJob<object>({ name: 'test.unit' });

/** Nothing listens on port 1: every connect is refused. */
function serviceWithDeadRedis(): QueueService {
  const config = {
    get: (key: string) =>
      key === 'REDIS_URL' ? 'redis://127.0.0.1:1' : undefined,
  } as unknown as ConfigService;
  return new QueueService(
    config,
    {} as TenantPrismaClient,
    {} as TenantsService,
  );
}

describe('QueueService with Redis down', () => {
  let service: QueueService;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = serviceWithDeadRedis();
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onApplicationShutdown();
    vi.restoreAllMocks();
  });

  it('enqueue fails fast with QueueUnavailableError, no hang', async () => {
    const started = Date.now();
    const error = await TenantContext.run(TENANT, () =>
      service.enqueue(def, {}, { idempotencyKey: 'k' }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QueueUnavailableError);
    expect((error as QueueUnavailableError).code).toBe('QUEUE_UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('health reports down quickly', async () => {
    const started = Date.now();
    await expect(service.health()).resolves.toBe('down');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('enqueue requires a tenant context', async () => {
    await expect(
      service.enqueue(def, {}, { idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
    await expect(
      TenantContext.runAsSystem(() =>
        service.enqueue(def, {}, { idempotencyKey: 'k' }),
      ),
    ).rejects.toMatchObject({ code: 'TENANT_CONTEXT_MISSING' });
  });

  it('refuses to enqueue after shutdown', async () => {
    const other = serviceWithDeadRedis();
    await other.onApplicationShutdown();
    await expect(
      TenantContext.run(TENANT, () =>
        other.enqueue(def, {}, { idempotencyKey: 'k' }),
      ),
    ).rejects.toBeInstanceOf(QueueUnavailableError);
  });
});

describe('jobIdFor', () => {
  it('is stable per definition, tenant and key, and has no colon', () => {
    const id = jobIdFor(def, TENANT, 'order:42');
    expect(id).toBe(jobIdFor(def, TENANT, 'order:42'));
    expect(id).not.toContain(':');
    expect(id).not.toBe(jobIdFor(def, TENANT, 'order:43'));
    expect(id).not.toBe(
      jobIdFor(def, '00000000-0000-4000-8000-000000000000', 'order:42'),
    );
    expect(id).not.toBe(
      jobIdFor(defineJob({ name: 'other' }), TENANT, 'order:42'),
    );
  });
});

describe('errorCode (what failure logs contain)', () => {
  it('keeps only the code, never the message', () => {
    expect(errorCode(new UnrecoverableError('INVALID_JOB_TENANT: x'))).toBe(
      'INVALID_JOB_TENANT',
    );
    expect(errorCode(new Error('password=hunter2'))).toBe('Error');
    expect(
      errorCode(Object.assign(new Error('token abc'), { code: 'ETIMEDOUT' })),
    ).toBe('ETIMEDOUT');
    expect(
      errorCode(Object.assign(new Error('x'), { code: 'secret value' })),
    ).toBe('Error');
  });
});
