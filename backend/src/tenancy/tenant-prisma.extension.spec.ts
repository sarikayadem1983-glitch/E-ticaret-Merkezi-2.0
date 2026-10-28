import { TenantContext } from './tenant-context.js';
import { applyTenantScope } from './tenant-prisma.extension.js';
import {
  TenantContextMissingError,
  TenantViolationError,
} from './tenant.errors.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';

const asA = <T>(fn: () => T) => TenantContext.run(A, fn);

describe('applyTenantScope', () => {
  describe('without tenant context', () => {
    it.each(['findMany', 'findUnique', 'create', 'updateMany', 'deleteMany'])(
      'refuses User.%s outside any store',
      (op) => {
        expect(() => applyTenantScope('User', op, {})).toThrow(
          TenantContextMissingError,
        );
      },
    );

    it('refuses inside an unauthenticated request store', () => {
      TenantContext.enter(() => {
        expect(() => applyTenantScope('User', 'findMany', {})).toThrow(
          TenantContextMissingError,
        );
      });
    });

    it('refuses raw SQL', () => {
      expect(() => applyTenantScope(undefined, '$queryRaw', {})).toThrow(
        TenantContextMissingError,
      );
    });
  });

  describe('reads', () => {
    it('adds tenantId to where', () => {
      expect(
        asA(() =>
          applyTenantScope('User', 'findMany', { where: { email: 'x' } }),
        ),
      ).toEqual({ where: { email: 'x', tenantId: A } });
    });

    it('adds tenantId when where is missing', () => {
      expect(asA(() => applyTenantScope('Role', 'count', undefined))).toEqual({
        where: { tenantId: A },
      });
    });

    it('scopes findUnique by id to the tenant', () => {
      expect(
        asA(() =>
          applyTenantScope('User', 'findUnique', { where: { id: 'u1' } }),
        ),
      ).toEqual({ where: { id: 'u1', tenantId: A } });
    });

    it('rejects an explicit foreign tenantId', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('User', 'findMany', { where: { tenantId: B } }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('rejects a tenantId filter object (e.g. { in: [...] })', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('User', 'findMany', {
            where: { tenantId: { in: [A, B] } },
          }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('rejects a foreign tenantId hidden in OR', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('User', 'findMany', {
            where: { OR: [{ tenantId: B }] },
          }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('pins the Tenant model to its own id', () => {
      expect(
        asA(() =>
          applyTenantScope('Tenant', 'findFirst', { where: { slug: 's' } }),
        ),
      ).toEqual({ where: { slug: 's', id: A } });
      expect(() =>
        asA(() =>
          applyTenantScope('Tenant', 'findUnique', { where: { id: B } }),
        ),
      ).toThrow(TenantViolationError);
    });
  });

  describe('writes', () => {
    it('fills tenantId on create', () => {
      expect(
        asA(() => applyTenantScope('Role', 'create', { data: { name: 'r' } })),
      ).toEqual({ data: { name: 'r', tenantId: A } });
    });

    it('fills tenantId on every createMany row', () => {
      expect(
        asA(() =>
          applyTenantScope('Role', 'createMany', {
            data: [{ name: 'a' }, { name: 'b', tenantId: A }],
          }),
        ),
      ).toEqual({
        data: [
          { name: 'a', tenantId: A },
          { name: 'b', tenantId: A },
        ],
      });
    });

    it('rejects create with a foreign tenantId', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('Role', 'create', {
            data: { name: 'r', tenantId: B },
          }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('rejects connecting to a foreign tenant', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('Role', 'create', {
            data: { name: 'r', tenant: { connect: { id: B } } },
          }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('rejects a foreign tenantId in a nested write', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('User', 'update', {
            where: { id: 'u1' },
            data: {
              userRoles: { create: { roleId: 'r1', tenantId: B } },
            },
          }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('rejects moving a row to another tenant', () => {
      expect(() =>
        asA(() =>
          applyTenantScope('User', 'updateMany', { data: { tenantId: B } }),
        ),
      ).toThrow(TenantViolationError);
    });

    it('scopes upsert where and create', () => {
      expect(
        asA(() =>
          applyTenantScope('Role', 'upsert', {
            where: { id: 'r1' },
            create: { name: 'r' },
            update: { name: 'r' },
          }),
        ),
      ).toEqual({
        where: { id: 'r1', tenantId: A },
        create: { name: 'r', tenantId: A },
        update: { name: 'r' },
      });
    });

    it('scopes deleteMany with no where', () => {
      expect(asA(() => applyTenantScope('User', 'deleteMany', {}))).toEqual({
        where: { tenantId: A },
      });
    });

    it('forbids creating tenants inside a tenant context', () => {
      expect(() =>
        asA(() => applyTenantScope('Tenant', 'create', { data: {} })),
      ).toThrow(TenantViolationError);
    });

    it('forbids raw SQL inside a tenant context', () => {
      expect(() =>
        asA(() => applyTenantScope(undefined, '$executeRaw', {})),
      ).toThrow(TenantViolationError);
    });

    it('fails closed on unknown operations', () => {
      expect(() =>
        asA(() => applyTenantScope('User', 'someFutureOp', {})),
      ).toThrow(TenantViolationError);
    });
  });

  describe('system context', () => {
    it('passes args through untouched', () => {
      const args = { where: { email: 'x' } };
      expect(
        TenantContext.runAsSystem(() =>
          applyTenantScope('User', 'findFirst', args),
        ),
      ).toBe(args);
    });

    it('does not leak into code after it returns', () => {
      TenantContext.runAsSystem(() => undefined);
      expect(() => applyTenantScope('User', 'findMany', {})).toThrow(
        TenantContextMissingError,
      );
    });
  });

  describe('append-only models (AuditLog)', () => {
    it.each(['update', 'updateMany', 'delete', 'deleteMany', 'upsert'])(
      'refuses AuditLog.%s in tenant and system context',
      (op) => {
        expect(() => asA(() => applyTenantScope('AuditLog', op, {}))).toThrow(
          TenantViolationError,
        );
        expect(() =>
          TenantContext.runAsSystem(() => applyTenantScope('AuditLog', op, {})),
        ).toThrow(TenantViolationError);
      },
    );

    it('allows create and reads, scoped to the tenant', () => {
      expect(
        asA(() =>
          applyTenantScope('AuditLog', 'create', { data: { module: 'm' } }),
        ),
      ).toEqual({ data: { module: 'm', tenantId: A } });
      expect(asA(() => applyTenantScope('AuditLog', 'findMany', {}))).toEqual({
        where: { tenantId: A },
      });
    });
  });

  describe('lazy thenables (PrismaPromise)', () => {
    it('run() executes a thenable inside the tenant store', async () => {
      const lazy = {
        // oxlint-disable-next-line unicorn/no-thenable -- simulates a lazy PrismaPromise
        then: (resolve: (v: string | undefined) => void) =>
          resolve(TenantContext.tenantId()),
      };
      await expect(TenantContext.run(A, () => lazy)).resolves.toBe(A);
    });
  });

  describe('setTenant', () => {
    it('cannot rebind a request to another tenant', () => {
      TenantContext.enter(() => {
        TenantContext.setTenant(A);
        expect(() => TenantContext.setTenant(B)).toThrow();
        expect(TenantContext.tenantId()).toBe(A);
      });
    });
  });
});
