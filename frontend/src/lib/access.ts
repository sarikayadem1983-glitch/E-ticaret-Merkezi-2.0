import type { CompanyRoleKey, MemberAccess } from './types';

/** What the access editor sends: the Admin switch or company + role rows. */
export type AccessValue =
  | { tenantRole: 'admin' }
  | { companyRoles: { companyId: string; roleKey: CompanyRoleKey }[] };

export const COMPANY_ROLES: { key: CompanyRoleKey; label: string }[] = [
  { key: 'operations', label: 'Operasyon' },
  { key: 'accounting', label: 'Muhasebe' },
  { key: 'viewer', label: 'Görüntüleyici' },
];

const TENANT_ROLE_LABELS = { owner: 'Mağaza sahibi', admin: 'Admin' } as const;

export function roleLabel(key: CompanyRoleKey): string {
  return COMPANY_ROLES.find((r) => r.key === key)?.label ?? key;
}

/** One line per member for the table, e.g. "Muhasebe — A Ltd.". */
export function describeAccess(access: MemberAccess): string[] {
  if ('tenantRole' in access) return [TENANT_ROLE_LABELS[access.tenantRole]];
  return access.companyRoles.map(
    (c) => `${roleLabel(c.roleKey)} — ${c.companyName ?? 'Bilinmeyen firma'}`,
  );
}

/** Editor value for a member's current access; owners are never edited. */
export function toAccessValue(access: MemberAccess): AccessValue {
  if ('tenantRole' in access) return { tenantRole: 'admin' };
  return {
    companyRoles: access.companyRoles.map(({ companyId, roleKey }) => ({
      companyId,
      roleKey,
    })),
  };
}

/**
 * Same rules as the backend: Admin, or at least one row, each with a company,
 * each company once. Returns a message, or null when the value can be sent.
 */
export function accessError(value: AccessValue): string | null {
  if ('tenantRole' in value) return null;
  const rows = value.companyRoles;
  if (rows.length === 0) return 'En az bir firma ve rol seçin.';
  if (rows.some((r) => r.companyId === '')) return 'Her satır için firma seçin.';
  if (new Set(rows.map((r) => r.companyId)).size !== rows.length) {
    return 'Bir firma yalnızca bir kez seçilebilir.';
  }
  return null;
}
