import type { AccessService } from '../access/access.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AccountsService } from '../auth/accounts.service.js';
import type { CompaniesService } from '../companies/companies.service.js';
import type { TenantPrismaClient } from '../database/prisma.service.js';
import type { MembershipsRepository } from '../memberships/memberships.repository.js';
import { UsersService } from './users.service.js';

describe('UsersService read profile', () => {
  it.each([new Date('2026-11-10T08:09:10.000Z'), null])(
    'includes lastLoginAt (%s) without exposing other account fields',
    async (lastLoginAt) => {
      const users = new UsersService(
        {} as TenantPrismaClient,
        {
          listForTenant: vi.fn().mockResolvedValue([
            {
              status: 'active',
              user: {
                id: 'user-1',
                name: 'Ayşe',
                email: 'ayse@example.test',
                lastLoginAt,
                passwordHash: 'must-not-leak',
              },
            },
          ]),
        } as unknown as MembershipsRepository,
        {
          accessOf: vi
            .fn()
            .mockResolvedValue(
              new Map([['user-1', { tenantRole: 'admin', companyRoles: [] }]]),
            ),
        } as unknown as AccessService,
        {} as AccountsService,
        {
          namesByIds: vi.fn().mockResolvedValue(new Map()),
        } as unknown as CompaniesService,
        {} as AuditService,
      );
      expect(await users.list()).toEqual([
        {
          userId: 'user-1',
          name: 'Ayşe',
          email: 'ayse@example.test',
          status: 'active',
          lastLoginAt,
          access: { tenantRole: 'admin' },
        },
      ]);
    },
  );
});
