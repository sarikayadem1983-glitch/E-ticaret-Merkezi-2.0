import { RequestContext } from '../common/request-context.js';
import type { AuditRepository, AuditRow } from './audit.repository.js';
import { REDACTED } from './audit.sanitizer.js';
import { AuditService } from './audit.service.js';

describe('AuditService.record', () => {
  const insert =
    vi.fn<(row: AuditRow, db?: unknown) => Promise<{ id: string }>>();
  const service = new AuditService({ insert } as unknown as AuditRepository);
  const lastRow = () => insert.mock.calls.at(-1)![0];

  beforeEach(() => {
    insert.mockReset().mockResolvedValue({ id: '1' });
  });

  const inRequest = (fn: () => Promise<void>) =>
    RequestContext.enter(
      { ipAddress: '10.0.0.1', userAgent: 'test-ua' },
      () => {
        RequestContext.setUser('user-1');
        return fn();
      },
    );

  it('takes actor, IP and user agent from the request context', async () => {
    await inRequest(() =>
      service.record({
        action: 'CREATE',
        module: 'm',
        entityType: 'E',
        entityId: 'e1',
      }),
    );
    expect(lastRow()).toMatchObject({
      actorUserId: 'user-1',
      ipAddress: '10.0.0.1',
      userAgent: 'test-ua',
      entityId: 'e1',
    });
  });

  it('lets the caller override the actor, including with null', async () => {
    await inRequest(() =>
      service.record({
        action: 'LOGIN_FAILED',
        module: 'auth',
        entityType: 'User',
        actorUserId: null,
      }),
    );
    expect(lastRow().actorUserId).toBeNull();
  });

  it('works outside a request with empty metadata', async () => {
    await service.record({ action: 'CREATE', module: 'm', entityType: 'E' });
    expect(lastRow()).toMatchObject({
      actorUserId: null,
      ipAddress: null,
      userAgent: null,
      entityId: null,
    });
  });

  it('stores only changed fields on UPDATE, sanitized', async () => {
    await service.record({
      action: 'UPDATE',
      module: 'm',
      entityType: 'E',
      before: { name: 'a', same: 1, password: 'old' },
      after: { name: 'b', same: 1, password: 'new' },
    });
    expect(lastRow().before).toEqual({ name: 'a', password: REDACTED });
    expect(lastRow().after).toEqual({ name: 'b', password: REDACTED });
  });

  it('sanitizes CREATE payloads', async () => {
    await service.record({
      action: 'CREATE',
      module: 'm',
      entityType: 'E',
      after: { email: 'a@b.c', passwordHash: '$argon2id$...' },
    });
    expect(lastRow().after).toEqual({ email: 'a@b.c', passwordHash: REDACTED });
  });

  it('passes the transaction client through', async () => {
    const tx = {};
    await service.record(
      { action: 'DELETE', module: 'm', entityType: 'E' },
      tx as never,
    );
    expect(insert.mock.calls.at(-1)![1]).toBe(tx);
  });
});
