import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { ROLE_CATALOG, rolePermissions } from './roles.catalog.js';

export interface AssignedRole {
  key: string | null;
  permissions: readonly string[];
}

const roleSelect = { role: { select: { key: true, permissions: true } } };

const resolve = (row: {
  role: { key: string | null; permissions: string[] };
}) => ({
  key: row.role.key,
  permissions: rolePermissions(row.role),
});

/**
 * Reads roles, user_roles and user_company_roles. Tenant-scoped by the Prisma
 * extension, except findMissingSystemRoles, which checks every tenant.
 */
@Injectable()
export class AccessRepository {
  constructor(@InjectPrisma() private readonly prisma: TenantPrismaClient) {}

  /** Union of the member's tenant role and company roles in the current tenant. */
  async findPermissions(userId: string): Promise<string[]> {
    const [tenantRoles, companyRoles] = await Promise.all([
      this.prisma.userRole.findMany({ where: { userId }, select: roleSelect }),
      this.prisma.userCompanyRole.findMany({
        where: { userId },
        select: roleSelect,
      }),
    ]);
    return [
      ...new Set(
        [...tenantRoles, ...companyRoles].flatMap(
          (r) => resolve(r).permissions,
        ),
      ),
    ];
  }

  /** The member's tenant role and their role in one company, read from the database. */
  async findRoles(
    userId: string,
    companyId: string,
  ): Promise<{ tenant: AssignedRole | null; company: AssignedRole | null }> {
    const [tenant, company] = await Promise.all([
      this.prisma.userRole.findFirst({ where: { userId }, select: roleSelect }),
      this.prisma.userCompanyRole.findFirst({
        where: { userId, companyId },
        select: roleSelect,
      }),
    ]);
    return {
      tenant: tenant && resolve(tenant),
      company: company && resolve(company),
    };
  }

  /** The member's tenant role (owner/admin), if any. */
  async findTenantRole(userId: string): Promise<AssignedRole | null> {
    const row = await this.prisma.userRole.findFirst({
      where: { userId },
      select: roleSelect,
    });
    return row && resolve(row);
  }

  /** The member's company roles in the current tenant. */
  async findCompanyRoles(
    userId: string,
  ): Promise<(AssignedRole & { companyId: string })[]> {
    const rows = await this.prisma.userCompanyRole.findMany({
      where: { userId },
      select: { companyId: true, ...roleSelect },
    });
    return rows.map((r) => ({ companyId: r.companyId, ...resolve(r) }));
  }

  /** System context: catalog roles missing from a live tenant. */
  findMissingSystemRoles(): Promise<{ tenantId: string; key: string }[]> {
    const keys = Object.keys(ROLE_CATALOG);
    return TenantContext.runAsSystem(
      () => this.prisma.$queryRaw<{ tenantId: string; key: string }[]>`
        SELECT t.id AS "tenantId", k.key
        FROM tenants t CROSS JOIN unnest(${keys}::text[]) AS k(key)
        WHERE t.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM roles r WHERE r.tenant_id = t.id AND r.key = k.key
          )
        ORDER BY t.id, k.key`,
    );
  }
}
