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
  companies?: (AssignedRole & { companyId: string })[];
}) {
  const repository = {
    findRoles: vi.fn().mockResolvedValue({
      tenant: roles.tenant ?? null,
      company: roles.company ?? null,
    }),
    findTenantRole: vi.fn().mockResolvedValue(roles.tenant ?? null),
    findCompanyRoles: vi.fn().mockResolvedValue(roles.companies ?? []),
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

describe('AccessService.seesAllCompanies', () => {
  it('is true only for a tenant role with companies:all', async () => {
    expect(
      await setup({ tenant: role('owner') }).service.seesAllCompanies('u1'),
    ).toBe(true);
    expect(
      await setup({ tenant: role('admin') }).service.seesAllCompanies('u1'),
    ).toBe(true);
    expect(await setup({}).service.seesAllCompanies('u1')).toBe(false);
  });
});

describe('AccessService.capabilities', () => {
  it('admin manages users and writes every company', async () => {
    expect(
      await setup({ tenant: role('admin') }).service.capabilities('u1'),
    ).toEqual({
      canManageUsers: true,
      canWriteAllCompanies: true,
      companyCapabilities: {},
    });
  });

  it('company roles are listed per company, read-only', async () => {
    const { service } = setup({
      companies: [
        { companyId: 'c1', ...role('operations') },
        { companyId: 'c2', ...role('viewer') },
      ],
    });
    expect(await service.capabilities('u1')).toEqual({
      canManageUsers: false,
      canWriteAllCompanies: false,
      companyCapabilities: { c1: { canWrite: false }, c2: { canWrite: false } },
    });
  });
});

describe('AccessService.companyScope', () => {
  it('null (every company) for a tenant role with companies:all and the permission', async () => {
    const { service } = setup({ tenant: role('admin') });
    await expect(service.companyScope(USER, 'products:read')).resolves.toBe(
      null,
    );
  });

  it('only companies whose role grants the permission', async () => {
    const { service } = setup({
      companies: [
        { companyId: 'c1', ...role('operations') },
        { companyId: 'c2', ...role('viewer') },
      ],
    });
    await expect(service.companyScope(USER, 'products:read')).resolves.toEqual([
      'c1',
      'c2',
    ]);
    await expect(service.companyScope(USER, 'products:write')).resolves.toEqual(
      ['c1'],
    );
  });

  it('empty without any role, whatever the JWT says', async () => {
    const { service } = setup({});
    await expect(service.companyScope(USER, 'products:read')).resolves.toEqual(
      [],
    );
  });
});
