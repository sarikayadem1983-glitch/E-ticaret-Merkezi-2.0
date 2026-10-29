import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/decorators.js';
import type { AccessRepository, AssignedRole } from './access.repository.js';
import { AccessService } from './access.service.js';
import { ROLE_CATALOG, type RoleKey } from './roles.catalog.js';

const role = (key: RoleKey): AssignedRole => ({
  key,
  permissions: ROLE_CATALOG[key].permissions,
});

// Stale JWT perms: company checks must ignore them.
const USER = { sub: 'u1', tid: 't1', perms: ['*'], ver: 1 } as AuthUser;

function setup(roles: {
  tenant?: AssignedRole | null;
  company?: AssignedRole | null;
}) {
  const repository = {
    findRoles: vi.fn().mockResolvedValue({
      tenant: roles.tenant ?? null,
      company: roles.company ?? null,
    }),
  };
  return {
    service: new AccessService(repository as unknown as AccessRepository),
    repository,
  };
}

describe('AccessService.assertCompanyPermission', () => {
  it('404 without a role in the company, whatever the JWT says', async () => {
    const { service } = setup({});
    await expect(
      service.assertCompanyPermission(USER, 'c1', 'companies:read'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 when the role in that company lacks the permission', async () => {
    const { service, repository } = setup({ company: role('viewer') });
    await expect(
      service.assertCompanyPermission(USER, 'c1', 'companies:write'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.findRoles).toHaveBeenCalledWith('u1', 'c1');
  });

  it('allows a permission the company role has', async () => {
    const { service } = setup({ company: role('accounting') });
    await expect(
      service.assertCompanyPermission(USER, 'c1', 'companies:read'),
    ).resolves.toBeUndefined();
  });

  it('tenant roles apply to every company', async () => {
    for (const key of ['owner', 'admin'] as const) {
      const { service } = setup({ tenant: role(key) });
      await expect(
        service.assertCompanyPermission(USER, 'c1', 'companies:write'),
      ).resolves.toBeUndefined();
    }
  });
});

describe('AccessService.companyRole', () => {
  it('prefers the tenant role', async () => {
    const { service } = setup({
      tenant: role('admin'),
      company: role('viewer'),
    });
    expect(await service.companyRole('u1', 'c1')).toBe('admin');
  });

  it('returns the company role, or null without one', async () => {
    expect(
      await setup({ company: role('operations') }).service.companyRole(
        'u1',
        'c1',
      ),
    ).toBe('operations');
    expect(await setup({}).service.companyRole('u1', 'c1')).toBeNull();
  });

  it('returns null for a custom role without a catalog key', async () => {
    const { service } = setup({
      company: { key: null, permissions: ['companies:read'] },
    });
    expect(await service.companyRole('u1', 'c1')).toBeNull();
  });
});
