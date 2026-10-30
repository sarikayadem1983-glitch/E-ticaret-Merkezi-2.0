import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assertNotLastOwner,
  assertNotSelf,
  canGrant,
} from '../access/access.rules.js';
import { AccessService, type MemberAccess } from '../access/access.service.js';
import type { RoleKey } from '../access/roles.catalog.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountsService } from '../auth/accounts.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { CompaniesService } from '../companies/companies.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import type { UpdateAccessDto } from './users.dto.js';

const MODULE = 'users';
const ENTITY = 'TenantMembership';

type Status = 'active' | 'inactive';
type CompanyRole = { companyId: string; roleKey: RoleKey };

/** Not a member of this tenant: the same answer for unknown ids and other tenants' users. */
const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'Kullanıcı bulunamadı' });

const notGrantable = () =>
  new ForbiddenException({
    code: 'ROLE_NOT_GRANTABLE',
    message: 'Bu kullanıcının erişimini değiştiremezsiniz',
  });

const sameRole = (a: CompanyRole, b: CompanyRole) =>
  a.companyId === b.companyId && a.roleKey === b.roleKey;

/**
 * Members of the current tenant: list, access editing, deactivation. Every
 * change runs in one transaction that locks the memberships of the actor, the
 * target and every owner (FOR UPDATE, user_id order), then re-reads the
 * actor's role from the database. So two concurrent changes cannot both pass
 * the last-owner check, and a JWT with stale permissions cannot act.
 *
 * Owner policy: an owner's role and access never change here (ownership
 * transfer is USR-21); an owner can be deactivated by another owner while at
 * least one other owner stays active.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly memberships: MembershipsRepository,
    private readonly access: AccessService,
    private readonly accounts: AccountsService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const members = await this.memberships.listForTenant();
    const ids = members.map((m) => m.user.id);
    const access = await this.access.accessOf(ids);
    const names = await this.companies.namesByIds([
      ...new Set(
        [...access.values()].flatMap((a) =>
          a.companyRoles.map((c) => c.companyId),
        ),
      ),
    ]);
    return members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      status: m.status,
      access: this.view(access.get(m.user.id)!, names),
    }));
  }

  async updateAccess(actor: AuthUser, userId: string, dto: UpdateAccessDto) {
    const requested = this.requested(dto);
    const after = await this.prisma.$transaction(async (tx) => {
      const { actorKey, targetKey } = await this.lockAndCheck(
        tx,
        actor,
        userId,
      );
      if (targetKey === 'owner') {
        throw new ForbiddenException({
          code: 'OWNER_IMMUTABLE',
          message: 'Sahibin rolü değiştirilemez',
        });
      }
      const keys =
        'tenantRole' in requested
          ? [requested.tenantRole]
          : requested.companyRoles.map((c) => c.roleKey);
      if (!keys.every((k) => canGrant(actorKey, k))) throw notGrantable();

      const roleIds = await this.access.systemRoleIds(tx);
      const before = (await this.access.accessOf([userId], tx)).get(userId)!;
      if ('tenantRole' in requested) {
        await this.access.replaceAccess(tx, userId, {
          tenantRoleId: this.roleId(roleIds, requested.tenantRole),
        });
      } else {
        const ids = requested.companyRoles.map((c) => c.companyId);
        const active = await this.companies.activeByIds(ids, tx);
        if (active.length !== ids.length) {
          throw new NotFoundException({
            code: 'NOT_FOUND',
            message: 'Firma bulunamadı',
          });
        }
        await this.access.replaceAccess(tx, userId, {
          companyRoles: requested.companyRoles.map((c) => ({
            companyId: c.companyId,
            roleId: this.roleId(roleIds, c.roleKey),
          })),
        });
      }
      const next = (await this.access.accessOf([userId], tx)).get(userId)!;
      await this.memberships.bumpAuthVersion(tx, actor.tid, userId);
      await this.recordAccessChange(tx, userId, before, next);
      return next;
    });
    const names = await this.companies.namesByIds(
      after.companyRoles.map((c) => c.companyId),
    );
    return { userId, access: this.view(after, names) };
  }

  /**
   * Deactivate keeps every role and company assignment and ends the member's
   * sessions in this tenant only (auth_version + refresh tokens). Activate
   * restores them; old refresh tokens stay revoked, so a fresh login is
   * needed. Setting the current status again changes nothing.
   */
  async setStatus(actor: AuthUser, userId: string, status: Status) {
    await this.prisma.$transaction(async (tx) => {
      const { targetKey, locked, owners } = await this.lockAndCheck(
        tx,
        actor,
        userId,
      );
      const current = locked.get(userId)!;
      if (current === status) return;
      if (status === 'inactive') {
        const activeOwners = owners.filter((id) => locked.get(id) === 'active');
        assertNotLastOwner(targetKey, activeOwners.length);
      }
      await this.memberships.setStatus(tx, userId, status);
      await this.memberships.bumpAuthVersion(tx, actor.tid, userId);
      if (status === 'inactive') {
        await this.accounts.revokeRefreshTokensInTenant(tx, userId);
      }
      await this.audit.record(
        {
          action:
            status === 'inactive'
              ? 'MEMBERSHIP_DEACTIVATED'
              : 'MEMBERSHIP_ACTIVATED',
          module: MODULE,
          entityType: ENTITY,
          entityId: userId,
          before: { status: current },
          after: { status },
        },
        tx,
      );
    });
    return { userId, status };
  }

  // ---- Internals --------------------------------------------------------

  /**
   * Locks the memberships of the actor, the target and every owner, then
   * checks: not self; target is a member here (404); actor is still active
   * and manages users by its tenant role, read from the database; only an
   * owner changes an owner or an admin.
   */
  private async lockAndCheck(tx: PrismaTx, actor: AuthUser, userId: string) {
    assertNotSelf(actor.sub, userId);
    const owners = await this.access.ownerUserIds(tx);
    const locked = await this.memberships.lockForUpdate(tx, actor.tid, [
      actor.sub,
      userId,
      ...owners,
    ]);
    if (!locked.has(userId)) throw notFound();
    const actorKey = await this.access.tenantRoleKey(actor.sub, tx);
    if (
      locked.get(actor.sub) !== 'active' ||
      !actorKey ||
      !(await this.access.hasTenantPermission(actor.sub, 'users:manage', tx))
    ) {
      throw new ForbiddenException('Yetki yok');
    }
    const targetKey = await this.access.tenantRoleKey(userId, tx);
    if (
      (targetKey === 'owner' || targetKey === 'admin') &&
      actorKey !== 'owner'
    ) {
      throw notGrantable();
    }
    return { actorKey, targetKey, locked, owners };
  }

  /** Exactly one of tenantRole and companyRoles (at least one, each company once). */
  private requested(
    dto: UpdateAccessDto,
  ): { tenantRole: RoleKey } | { companyRoles: CompanyRole[] } {
    const hasTenant = dto.tenantRole !== undefined;
    const hasCompany = dto.companyRoles !== undefined;
    if (hasTenant === hasCompany) {
      throw new BadRequestException({
        code: 'ROLE_REQUIRED',
        message: 'Ya Admin rolü ya da firma rolleri seçilmeli',
      });
    }
    if (hasTenant) return { tenantRole: dto.tenantRole! };
    const roles = dto.companyRoles!;
    if (roles.length === 0) {
      throw new BadRequestException({
        code: 'COMPANY_REQUIRED',
        message: 'Firma rolü için en az bir firma seçilmeli',
      });
    }
    if (new Set(roles.map((r) => r.companyId)).size !== roles.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_COMPANY',
        message: 'Bir firma yalnızca bir kez seçilebilir',
      });
    }
    return { companyRoles: roles };
  }

  private roleId(ids: Map<RoleKey, string>, key: RoleKey): string {
    const id = ids.get(key);
    if (!id) {
      throw new ConflictException({
        code: 'ROLE_MISSING',
        message: 'Sistem rolü bulunamadı',
      });
    }
    return id;
  }

  private view(access: MemberAccess, names: Map<string, string>) {
    return access.tenantRole
      ? { tenantRole: access.tenantRole }
      : {
          companyRoles: access.companyRoles.map((c) => ({
            companyId: c.companyId,
            companyName: names.get(c.companyId) ?? null,
            roleKey: c.roleKey,
          })),
        };
  }

  /** ROLE_CHANGED for the tenant role, COMPANY_ACCESS_CHANGED for company roles. No secrets. */
  private async recordAccessChange(
    tx: PrismaTx,
    userId: string,
    before: MemberAccess,
    after: MemberAccess,
  ) {
    const base = { module: MODULE, entityType: ENTITY, entityId: userId };
    if (before.tenantRole !== after.tenantRole) {
      await this.audit.record(
        {
          ...base,
          action: 'ROLE_CHANGED',
          before: { tenantRole: before.tenantRole },
          after: { tenantRole: after.tenantRole },
        },
        tx,
      );
    }
    const added = after.companyRoles.filter(
      (a) => !before.companyRoles.some((b) => sameRole(a, b)),
    );
    const removed = before.companyRoles.filter(
      (b) => !after.companyRoles.some((a) => sameRole(a, b)),
    );
    if (added.length > 0 || removed.length > 0) {
      await this.audit.record(
        {
          ...base,
          action: 'COMPANY_ACCESS_CHANGED',
          before: { companyRoles: before.companyRoles },
          after: { companyRoles: after.companyRoles, added, removed },
        },
        tx,
      );
    }
  }
}
