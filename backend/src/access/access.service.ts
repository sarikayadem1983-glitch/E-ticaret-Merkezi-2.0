import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/decorators.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { AccessRepository, type AssignedRole } from './access.repository.js';
import { isRoleKey, type RoleKey } from './roles.catalog.js';

/** A member's roles in the current tenant, by catalog key. */
export interface MemberAccess {
  tenantRole: RoleKey | null;
  companyRoles: { companyId: string; roleKey: RoleKey }[];
}

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

  /** Tenant context. The member's tenant role key (owner/admin), read from the database. */
  async tenantRoleKey(userId: string, db?: PrismaTx): Promise<RoleKey | null> {
    const role = await this.repository.findTenantRole(userId, db);
    return isRoleKey(role?.key) ? role.key : null;
  }

  /** Tenant context. Catalog role key → role id in the current tenant. */
  async systemRoleIds(db?: PrismaTx): Promise<Map<RoleKey, string>> {
    const rows = await this.repository.findSystemRoles(db);
    return new Map(
      rows.flatMap((r) => (isRoleKey(r.key) ? [[r.key, r.id] as const] : [])),
    );
  }

  /** Tenant context. Role id → catalog key; ids of other tenants or custom roles are absent. */
  async roleKeysByIds(
    ids: string[],
    db?: PrismaTx,
  ): Promise<Map<string, RoleKey>> {
    const rows = await this.repository.findRolesByIds(ids, db);
    return new Map(
      rows.flatMap((r) => (isRoleKey(r.key) ? [[r.id, r.key] as const] : [])),
    );
  }

  /** Tenant context, inside the caller's transaction. Writes user_roles. */
  assignTenantRole(tx: PrismaTx, userId: string, roleId: string) {
    return this.repository.insertTenantRole(tx, userId, roleId);
  }

  /** Tenant context, inside the caller's transaction. Writes user_company_roles. */
  assignCompanyRoles(
    tx: PrismaTx,
    userId: string,
    roles: { companyId: string; roleId: string }[],
  ) {
    return this.repository.insertCompanyRoles(tx, userId, roles);
  }

  /** Tenant context. True when the member's tenant role grants `permission` (read from the database). */
  async hasTenantPermission(
    userId: string,
    permission: string,
    db?: PrismaTx,
  ): Promise<boolean> {
    const role = await this.repository.findTenantRole(userId, db);
    return !!role && allows(role, permission);
  }

  /**
   * Tenant context. Each member's access: a tenant role (owner/admin) or
   * company roles. Members without any role get no tenant role and no
   * company roles.
   */
  async accessOf(
    userIds: string[],
    db?: PrismaTx,
  ): Promise<Map<string, MemberAccess>> {
    const { tenant, company } = await this.repository.findRolesOfUsers(
      userIds,
      db,
    );
    const result = new Map<string, MemberAccess>(
      userIds.map((id) => [id, { tenantRole: null, companyRoles: [] }]),
    );
    for (const r of company) {
      if (isRoleKey(r.role.key)) {
        result.get(r.userId)?.companyRoles.push({
          companyId: r.companyId,
          roleKey: r.role.key,
        });
      }
    }
    for (const r of tenant) {
      const entry = result.get(r.userId);
      if (entry && isRoleKey(r.role.key)) entry.tenantRole = r.role.key;
    }
    return result;
  }

  /** Tenant context, inside the caller's transaction. Owners of the tenant, active or not. */
  ownerUserIds(tx: PrismaTx): Promise<string[]> {
    return this.repository.findUserIdsWithRoleKey('owner', tx);
  }

  /**
   * Tenant context, inside the caller's transaction: replaces every role of
   * the member with one tenant role or the given company roles.
   */
  async replaceAccess(
    tx: PrismaTx,
    userId: string,
    access:
      | { tenantRoleId: string }
      | { companyRoles: { companyId: string; roleId: string }[] },
  ): Promise<void> {
    await this.repository.deleteRolesOf(tx, userId);
    if ('tenantRoleId' in access) {
      await this.repository.insertTenantRole(tx, userId, access.tenantRoleId);
    } else {
      await this.repository.insertCompanyRoles(tx, userId, access.companyRoles);
    }
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
