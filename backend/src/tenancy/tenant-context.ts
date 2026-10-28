import { AsyncLocalStorage } from 'node:async_hooks';
import { TenantContextMissingError } from './tenant.errors.js';

interface TenantStore {
  tenantId?: string;
  system?: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Prisma queries are lazy: they execute when awaited, not when created. Awaiting
 * inside the store makes `run(id, () => prisma.x.findMany())` execute in that store.
 */
function runIn<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, () => {
    const result = fn();
    return (isThenable(result) ? (async () => await result)() : result) as T;
  });
}

/**
 * Ambient tenant for the current async call chain. The tenant Prisma extension
 * reads it on every query and refuses to run when it is missing.
 */
export const TenantContext = {
  /** Starts an empty, request-scoped store. The auth guard fills it later. */
  enter<T>(fn: () => T): T {
    return storage.run({}, fn);
  },

  /** Binds the tenant of the authenticated request. Cannot be changed once set. */
  setTenant(tenantId: string): void {
    const store = storage.getStore();
    if (!store || store.system) {
      throw new Error('TenantContext.setTenant called outside a request store');
    }
    if (store.tenantId && store.tenantId !== tenantId) {
      throw new Error('Tenant already bound for this request');
    }
    store.tenantId = tenantId;
  },

  /** Runs fn scoped to tenantId. Use in workers and after resolving the tenant in auth flows. */
  run<T>(tenantId: string, fn: () => T): T {
    return runIn({ tenantId }, fn);
  },

  /**
   * Runs fn WITHOUT tenant filtering. Only for flows that happen before a tenant
   * is known (login, register, refresh token lookup, health check). Callers are
   * pinned by an allowlist test (tenant-context.allowlist.spec.ts).
   */
  runAsSystem<T>(fn: () => T): T {
    return runIn({ system: true }, fn);
  },

  tenantId(): string | undefined {
    const store = storage.getStore();
    return store?.system ? undefined : store?.tenantId;
  },

  /** Tenant of the current context; throws when there is none. For filling tenantId on writes. */
  requireTenantId(): string {
    const tenantId = TenantContext.tenantId();
    if (!tenantId) throw new TenantContextMissingError('requireTenantId');
    return tenantId;
  },

  isSystem(): boolean {
    return storage.getStore()?.system === true;
  },
};
