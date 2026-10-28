import { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from './tenant-context.js';
import {
  TenantContextMissingError,
  TenantViolationError,
} from './tenant.errors.js';

/** Model keyed by its own id instead of a tenantId column. */
const TENANT_ROOT_MODEL = 'Tenant';

/**
 * Global models have no tenant column (one identity across tenants). They are only
 * reachable in system context; inside a tenant, read them through TenantMembership.
 */
export const GLOBAL_MODELS = new Set(['User']);

/**
 * Relation fields (on any model) whose target is a global model. Kept in sync
 * with schema.prisma by a unit test. In tenant context, nested writes through
 * them are refused; only `connect` (no global row is written) is allowed.
 */
export const GLOBAL_RELATION_FIELDS = new Set(['user', 'acceptedBy']);
const NESTED_GLOBAL_ALLOWED = new Set(['connect']);

/** Refuses nested writes that would create/modify a global (User) row from a tenant. */
function assertNoGlobalWrite(value: unknown, op: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoGlobalWrite(item, op));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (GLOBAL_RELATION_FIELDS.has(key) && isObject(child)) {
      const writes = Object.keys(child).filter(
        (k) => !NESTED_GLOBAL_ALLOWED.has(k),
      );
      if (writes.length > 0) {
        throw new TenantViolationError(
          op,
          `global model tenant bağlamında yazılamaz (${key}.${writes.join(',')})`,
        );
      }
      continue;
    }
    assertNoGlobalWrite(child, op);
  }
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Append-only models: only create and read operations are ever allowed, even in system context. */
const APPEND_ONLY_MODELS = new Set(['AuditLog']);
const APPEND_ONLY_ALLOWED = new Set([
  'create',
  'createMany',
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const CREATE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
]);

type Args = Record<string, unknown>;

function isObject(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rejects any tenantId (or tenant relation) in the payload that is not ours. Covers nested writes. */
function assertNoForeignTenant(
  value: unknown,
  tenantId: string,
  op: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForeignTenant(item, tenantId, op));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'tenantId' && child !== undefined && child !== tenantId) {
      throw new TenantViolationError(op, 'payload başka bir tenantId içeriyor');
    }
    if (key === 'tenant' && isObject(child)) {
      const connect = child.connect;
      const onlyConnect = Object.keys(child).length === 1;
      if (!onlyConnect || !isObject(connect) || connect.id !== tenantId) {
        throw new TenantViolationError(
          op,
          'tenant ilişkisi yalnızca kendi tenantına connect olabilir',
        );
      }
      continue;
    }
    assertNoForeignTenant(child, tenantId, op);
  }
}

function scopeWhere(
  model: string,
  where: unknown,
  tenantId: string,
  op: string,
): Args {
  const base = isObject(where) ? where : {};
  const key = model === TENANT_ROOT_MODEL ? 'id' : 'tenantId';
  if (key in base && base[key] !== tenantId) {
    throw new TenantViolationError(op, `where.${key} başka bir tenanta ait`);
  }
  assertNoForeignTenant(base, tenantId, op);
  return { ...base, [key]: tenantId };
}

function scopeCreateData(data: unknown, tenantId: string, op: string): Args {
  if (!isObject(data)) {
    throw new TenantViolationError(op, 'create verisi nesne olmalı');
  }
  assertNoForeignTenant(data, tenantId, op);
  return 'tenant' in data ? data : { ...data, tenantId };
}

/** Pure transform applied to every query. Exported for unit tests. */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: unknown,
): unknown {
  const label = model ? `${model}.${operation}` : operation;

  if (
    model &&
    APPEND_ONLY_MODELS.has(model) &&
    !APPEND_ONLY_ALLOWED.has(operation)
  ) {
    throw new TenantViolationError(label, 'bu model yalnızca eklemeye açık');
  }

  if (TenantContext.isSystem()) return args;

  const tenantId = TenantContext.tenantId();
  if (!tenantId) throw new TenantContextMissingError(label);

  if (model && GLOBAL_MODELS.has(model)) {
    throw new TenantViolationError(
      label,
      'global model tenant bağlamında kullanılamaz; üyelik üzerinden okuyun',
    );
  }

  if (!model) {
    throw new TenantViolationError(label, 'ham SQL tenant bağlamında yasak');
  }

  if (
    model === TENANT_ROOT_MODEL &&
    (CREATE_OPERATIONS.has(operation) || operation === 'upsert')
  ) {
    throw new TenantViolationError(
      label,
      'tenant bağlamında yeni tenant oluşturulamaz',
    );
  }

  const scoped: Args = isObject(args) ? { ...args } : {};
  // Reads (include/select of user fields) are allowed; writes are not.
  assertNoGlobalWrite(scoped.data, label);
  assertNoGlobalWrite(scoped.create, label);
  assertNoGlobalWrite(scoped.update, label);

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = scopeWhere(model, scoped.where, tenantId, label);
    assertNoForeignTenant(scoped.data, tenantId, label);
    if (operation === 'upsert') {
      scoped.create = scopeCreateData(scoped.create, tenantId, label);
      assertNoForeignTenant(scoped.update, tenantId, label);
    }
    return scoped;
  }

  if (CREATE_OPERATIONS.has(operation)) {
    scoped.data = Array.isArray(scoped.data)
      ? scoped.data.map((row) => scopeCreateData(row, tenantId, label))
      : scopeCreateData(scoped.data, tenantId, label);
    return scoped;
  }

  // Unknown operation: fail closed instead of running it unscoped.
  throw new TenantViolationError(label, 'tenant filtresi uygulanamayan işlem');
}

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allOperations({ model, operation, args, query }) {
      return query(applyTenantScope(model, operation, args) as typeof args);
    },
  },
});
