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
    if (!role) throw new NotFoundException('Firma bulunamadı');
    if (!allows(role, permission)) throw new ForbiddenException('Yetki yok');
  }
}
