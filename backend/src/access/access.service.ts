import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/decorators.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AccessRepository, type AssignedRole } from './access.repository.js';
import { isRoleKey, type RoleKey } from './roles.catalog.js';

const allows = (role: AssignedRole, permission: string) =>
  role.permissions.includes('*') || role.permissions.includes(permission);

/**
 * Role-based access decisions. Company checks always read the member's role in
 * that company from the database; the JWT `perms` are never trusted for them.
 */
@Injectable()
export class AccessService {
  constructor(private readonly repository: AccessRepository) {}

  /** Tenant role ∪ company roles: the JWT `perms`. */
  tenantPermissions(tenantId: string, userId: string): Promise<string[]> {
    return TenantContext.run(tenantId, () =>
      this.repository.findPermissions(userId),
    );
  }

  /** Tenant context. A tenant role (owner/admin) applies to every company. */
  async companyRole(
    userId: string,
    companyId: string,
  ): Promise<RoleKey | null> {
    const { tenant, company } = await this.repository.findRoles(
      userId,
      companyId,
    );
    const key = tenant?.key ?? company?.key;
    return isRoleKey(key) ? key : null;
  }

  /**
   * Tenant context. No role in the company → 404 (its existence is not
   * revealed); a role there without the permission → 403.
   */
  async assertCompanyPermission(
    user: AuthUser,
    companyId: string,
    permission: string,
  ): Promise<void> {
    const { tenant, company } = await this.repository.findRoles(
      user.sub,
      companyId,
    );
    const role = tenant ?? company;
    if (!role) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Firma bulunamadı',
      });
    }
    if (!allows(role, permission)) throw new ForbiddenException('Yetki yok');
  }

  /** Tenant context. True when the tenant role covers every company. */
  async seesAllCompanies(userId: string): Promise<boolean> {
    const role = await this.repository.findTenantRole(userId);
    return !!role && allows(role, 'companies:all');
  }

  /**
   * Tenant context. Companies where the member's role grants `permission`,
   * read from the database: `null` means every company (a tenant role with
   * `companies:all` and the permission).
   */
  async companyScope(
    user: AuthUser,
    permission: string,
  ): Promise<string[] | null> {
    const [tenant, companies] = await Promise.all([
      this.repository.findTenantRole(user.sub),
      this.repository.findCompanyRoles(user.sub),
    ]);
    if (
      tenant &&
      allows(tenant, permission) &&
      allows(tenant, 'companies:all')
    ) {
      return null;
    }
    return companies
      .filter((c) => allows(c, permission))
      .map((c) => c.companyId);
  }

  /**
   * Tenant context. UI flags for `auth/me`, read from the database. A tenant
   * role writes every company (`canWriteAllCompanies`); company roles are
   * listed per company.
   */
  async capabilities(userId: string): Promise<{
    canManageUsers: boolean;
    canWriteAllCompanies: boolean;
    companyCapabilities: Record<string, { canWrite: boolean }>;
  }> {
    const [tenant, companies] = await Promise.all([
      this.repository.findTenantRole(userId),
      this.repository.findCompanyRoles(userId),
    ]);
    return {
      canManageUsers: !!tenant && allows(tenant, 'users:manage'),
      canWriteAllCompanies: !!tenant && allows(tenant, 'companies:write'),
      companyCapabilities: Object.fromEntries(
        companies.map((c) => [
          c.companyId,
          { canWrite: allows(c, 'companies:write') },
        ]),
      ),
    };
  }
}
