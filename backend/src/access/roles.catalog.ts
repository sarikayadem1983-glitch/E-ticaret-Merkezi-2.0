/**
 * System roles. The single source of truth for their permissions: at runtime a
 * role with a `key` takes its permissions from here, not from roles.permissions.
 * `name` matches the rows seeded by migration 20261029090000_tenant_memberships;
 * `products:*` were added to the stored copies by 20261029120000_catalog_schema.
 */
export type RoleKey =
  'owner' | 'admin' | 'operations' | 'accounting' | 'viewer';

export interface CatalogRole {
  scope: 'tenant' | 'company';
  name: string;
  permissions: readonly string[];
}

export const ROLE_CATALOG: Record<RoleKey, CatalogRole> = {
  owner: { scope: 'tenant', name: 'owner', permissions: ['*'] },
  admin: {
    scope: 'tenant',
    name: 'Admin',
    permissions: [
      'companies:read',
      'companies:write',
      'companies:all',
      'users:read',
      'users:invite',
      'users:manage',
      'audit:read',
      'products:read',
      'products:write',
    ],
  },
  operations: {
    scope: 'company',
    name: 'Operasyon',
    permissions: ['companies:read', 'products:read', 'products:write'],
  },
  accounting: {
    scope: 'company',
    name: 'Muhasebe',
    permissions: ['companies:read', 'products:read'],
  },
  viewer: {
    scope: 'company',
    name: 'Görüntüleyici',
    permissions: ['companies:read', 'products:read'],
  },
};

export function isRoleKey(key: string | null | undefined): key is RoleKey {
  return key != null && Object.hasOwn(ROLE_CATALOG, key);
}

/** Catalog permissions for keyed roles; stored permissions for legacy/custom (key = null) roles. */
export function rolePermissions(role: {
  key: string | null;
  permissions: string[];
}): readonly string[] {
  return isRoleKey(role.key)
    ? ROLE_CATALOG[role.key].permissions
    : role.permissions;
}
