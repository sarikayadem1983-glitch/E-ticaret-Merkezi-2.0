import { ROLE_CATALOG, type RoleKey } from './roles.catalog.js';

const TENANT_WIDE = /^(users:|audit:|companies:all$)|^\*$/;

describe('ROLE_CATALOG', () => {
  const companyRoles = (Object.keys(ROLE_CATALOG) as RoleKey[]).filter(
    (k) => ROLE_CATALOG[k].scope === 'company',
  );

  it('has the three company roles', () => {
    expect(companyRoles.sort()).toEqual(['accounting', 'operations', 'viewer']);
  });

  it('company roles never contain tenant-wide permissions', () => {
    for (const key of companyRoles) {
      const leaked = ROLE_CATALOG[key].permissions.filter((p) =>
        TENANT_WIDE.test(p),
      );
      expect({ key, leaked }).toEqual({ key, leaked: [] });
    }
  });

  it('the tenant-wide pattern catches every form it guards against', () => {
    for (const p of [
      'users:read',
      'users:manage',
      'audit:read',
      'companies:all',
      '*',
    ])
      expect(TENANT_WIDE.test(p)).toBe(true);
    for (const p of ['companies:read', 'companies:write'])
      expect(TENANT_WIDE.test(p)).toBe(false);
  });
});
