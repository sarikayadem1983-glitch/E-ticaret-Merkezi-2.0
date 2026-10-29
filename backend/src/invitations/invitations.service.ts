import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { canGrant } from '../access/access.rules.js';
import { AccessService } from '../access/access.service.js';
import { ROLE_CATALOG, type RoleKey } from '../access/roles.catalog.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountsService } from '../auth/accounts.service.js';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { maskEmail } from '../common/mask-email.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { MailDeliveryError } from '../mail/mail.errors.js';
import { MailService } from '../mail/mail.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { invitationMail } from './invitation-mail.js';
import { hashInvitationToken, newInvitationToken } from './invitation-token.js';
import {
  INVITATIONS_CONFIG,
  type InvitationsConfig,
} from './invitations.config.js';
import type {
  AcceptInvitationDto,
  CreateInvitationDto,
} from './invitations.dto.js';
import {
  type InvitationRow,
  InvitationsRepository,
  type StoredCompanyRole,
} from './invitations.repository.js';

const MODULE = 'invitations';
const ENTITY = 'Invitation';

export type Delivery = 'sent' | 'failed';

/** The roles an invitation grants, by catalog key. */
interface Grant {
  tenantRole: RoleKey | null;
  companyRoles: { companyId: string; roleKey: RoleKey; roleId: string }[];
}

/**
 * One answer for every unusable token: unknown, revoked, expired, used, or no
 * longer valid because the inviter, the store or the companies changed.
 */
function invalid() {
  return new NotFoundException({
    code: 'INVITATION_INVALID',
    message: 'Davet bağlantısı geçersiz veya süresi dolmuş',
  });
}

function notFound() {
  return new NotFoundException({
    code: 'NOT_FOUND',
    message: 'Davet bulunamadı',
  });
}

function notGrantable() {
  return new ForbiddenException({
    code: 'ROLE_NOT_GRANTABLE',
    message: 'Bu rolü veremezsiniz',
  });
}

function notPending() {
  return new ConflictException({
    code: 'INVITATION_NOT_PENDING',
    message: 'Davet artık beklemede değil',
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * E-mail invitations: create, resend, revoke, lookup and accept. Only the
 * SHA-256 of a token is stored; a token is single-use and expires. Nothing is
 * granted until accept commits, and accept re-checks that the invitation is
 * still valid (inviter's rights, store, companies).
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly repository: InvitationsRepository,
    private readonly access: AccessService,
    private readonly accounts: AccountsService,
    private readonly loginLimits: AuthRateLimitService,
    private readonly companies: CompaniesService,
    private readonly memberships: MembershipsRepository,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(INVITATIONS_CONFIG) private readonly config: InvitationsConfig,
  ) {}

  // ---- Tenant side (authenticated, tenant context) ----------------------

  async create(actor: AuthUser, dto: CreateInvitationDto) {
    const requested = this.requestedKeys(dto);
    await this.assertGrantable(
      actor.sub,
      requested.map((r) => r.roleKey),
    );

    const companyIds = dto.companyRoles?.map((c) => c.companyId) ?? [];
    if (new Set(companyIds).size !== companyIds.length) {
      throw new BadRequestException({
        code: 'DUPLICATE_COMPANY',
        message: 'Bir firma yalnızca bir kez seçilebilir',
      });
    }
    if (companyIds.length > 0) {
      const active = await this.companies.activeByIds(companyIds);
      if (active.length !== companyIds.length) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Firma bulunamadı',
        });
      }
    }

    // Only this tenant's memberships are visible: whether the address has an
    // account elsewhere is never revealed.
    const membership = await this.memberships.findByEmail(dto.email);
    if (membership?.status === 'active') {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'Bu kişi zaten mağazanın üyesi',
      });
    }
    if (membership) {
      // Re-opening an inactive membership by invitation is USR-T10b.
      throw new ConflictException({
        code: 'MEMBERSHIP_INACTIVE',
        message:
          'Bu kişinin mağazada pasif bir üyeliği var; önce üyeliği aktifleştirin',
      });
    }

    const roleIds = await this.access.systemRoleIds();
    const roleId = (key: RoleKey) => {
      const id = roleIds.get(key);
      if (!id) throw new Error(`Sistem rolü eksik: ${key}`);
      return id;
    };
    const tenantRole = dto.tenantRole ? roleId(dto.tenantRole) : null;
    const companyRoles: StoredCompanyRole[] = (dto.companyRoles ?? []).map(
      (c) => ({ companyId: c.companyId, roleId: roleId(c.roleKey) }),
    );

    const { token, hash } = newInvitationToken();
    const expiresAt = new Date(Date.now() + this.config.ttlMs);
    let id: string;
    try {
      id = await this.repository.prisma.$transaction(async (tx) => {
        const created = await this.repository.create(tx, {
          email: dto.email,
          tenantRoleId: tenantRole,
          companyRoles,
          tokenHash: hash,
          expiresAt,
          invitedByUserId: actor.sub,
        });
        await this.audit.record(
          {
            action: 'INVITATION_CREATED',
            module: MODULE,
            entityType: ENTITY,
            entityId: created.id,
            after: {
              email: dto.email,
              tenantRole: dto.tenantRole ?? null,
              companyRoles: dto.companyRoles ?? [],
              expiresAt,
            },
          },
          tx,
        );
        return created.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'INVITATION_PENDING',
          message:
            'Bu e-postaya bekleyen bir davet var; yeniden gönder kullanın',
        });
      }
      throw error;
    }

    // Sent after commit: a failed e-mail never rolls back the invitation.
    const delivery = await this.deliver(
      actor.tid,
      { id, email: dto.email, invitedByUserId: actor.sub, expiresAt },
      token,
    );
    return {
      id,
      status: 'pending' as const,
      delivery,
      replacesInactiveMembership: false,
    };
  }

  /** Pending invitations of the current tenant; expired ones are flagged. */
  async listPending() {
    const rows = await this.repository.listPending();
    const keys = await this.access.roleKeysByIds([
      ...new Set(rows.flatMap((r) => this.roleIdsOf(r))),
    ]);
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.expiresAt.getTime() <= now ? ('expired' as const) : r.status,
      tenantRole: r.tenantRoleId ? (keys.get(r.tenantRoleId) ?? null) : null,
      companyRoles: r.companyRoles.map((c) => ({
        companyId: c.companyId,
        roleKey: keys.get(c.roleId) ?? null,
      })),
      invitedByUserId: r.invitedByUserId,
      expiresAt: r.expiresAt,
      lastSentAt: r.lastSentAt,
      sendAttempts: r.sendAttempts,
      lastSendError: r.lastSendError,
      createdAt: r.createdAt,
    }));
  }

  /** New token (the old link stops working) and a fresh expiry. */
  async resend(actor: AuthUser, id: string) {
    const invitation = await this.pendingForActor(actor, id);
    const { token, hash } = newInvitationToken();
    const expiresAt = new Date(Date.now() + this.config.ttlMs);
    await this.repository.prisma.$transaction(async (tx) => {
      if (!(await this.repository.rotateToken(tx, id, hash, expiresAt))) {
        throw notPending();
      }
      await this.audit.record(
        {
          action: 'INVITATION_RESENT',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          after: { expiresAt },
        },
        tx,
      );
    });
    const delivery = await this.deliver(
      actor.tid,
      { ...invitation, expiresAt },
      token,
    );
    return { id, status: 'pending' as const, delivery };
  }

  async revoke(actor: AuthUser, id: string) {
    await this.pendingForActor(actor, id);
    await this.repository.prisma.$transaction(async (tx) => {
      if (!(await this.repository.revoke(tx, id))) throw notPending();
      await this.audit.record(
        {
          action: 'INVITATION_REVOKED',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          before: { status: 'pending' },
          after: { status: 'revoked' },
        },
        tx,
      );
    });
    return { id, status: 'revoked' as const };
  }

  // ---- Public side (token holder, no session) ---------------------------

  async lookup(token: string) {
    const invitation = await this.repository.findUsableByTokenHash(
      hashInvitationToken(token),
    );
    if (!invitation) throw invalid();
    const view = await TenantContext.run(invitation.tenantId, async () => {
      const prisma = this.repository.prisma;
      if (!(await this.tenants.isActive(prisma, invitation.tenantId))) {
        return null;
      }
      const [tenant, inviter, summary] = await Promise.all([
        this.tenants.profile(prisma, invitation.tenantId),
        this.memberships.get(invitation.tenantId, invitation.invitedByUserId),
        this.summary(invitation),
      ]);
      return tenant && inviter?.status === 'active' && summary !== null
        ? {
            tenantName: tenant.name,
            inviterName: inviter.user.name,
            roleSummary: summary,
          }
        : null;
    });
    if (!view) throw invalid();
    // Shown only to whoever holds the token, i.e. the invited mailbox.
    const accountExists =
      (await this.accounts.findByEmail(invitation.email)) !== null;
    return {
      ...view,
      maskedEmail: maskEmail(invitation.email),
      accountExists,
      replacesInactiveMembership: false,
    };
  }

  /**
   * New account: name + password. Existing account: its password (the token
   * alone is not enough). Everything is granted in one transaction; the
   * response carries no tokens and does not switch the caller's store.
   */
  async accept(dto: AcceptInvitationDto, ip?: string) {
    const tokenHash = hashInvitationToken(dto.token);
    const invitation = await this.repository.findUsableByTokenHash(tokenHash);
    if (!invitation) throw invalid();

    const account = await this.accounts.findByEmail(invitation.email);
    let newAccount: { name: string; passwordHash: string } | null = null;
    if (account) {
      // Same per-account / per-IP lockout as /auth/login (keys depend only on
      // the e-mail and IP), so the invitation cannot be used to guess the
      // password of an existing account. Fail-closed when Redis is down.
      await this.loginLimits.beforeLogin(ip, invitation.email);
      if (!(await this.accounts.verifyPassword(account, dto.password))) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Şifre hatalı',
        });
      }
      await this.loginLimits.loginSucceeded(ip, invitation.email);
    } else {
      newAccount = {
        name: this.validateNewAccount(dto),
        passwordHash: await this.accounts.hashPassword(dto.password),
      };
    }

    try {
      return await this.acceptInTransaction(
        invitation,
        tokenHash,
        account,
        newAccount,
      );
    } catch (error) {
      // Another request created the account after our check: the whole
      // transaction rolled back, the invitation is still pending.
      if (!account && isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'ACCOUNT_EXISTS',
          message:
            'Bu e-postayla bir hesap oluşturuldu; mevcut hesabın şifresiyle tekrar deneyin',
        });
      }
      throw error;
    }
  }

  private acceptInTransaction(
    invitation: InvitationRow,
    tokenHash: string,
    account: Awaited<ReturnType<AccountsService['findByEmail']>>,
    newAccount: { name: string; passwordHash: string } | null,
  ) {
    const tenantId = invitation.tenantId;
    return TenantContext.run(tenantId, () =>
      this.repository.prisma.$transaction(async (tx) => {
        if (!(await this.repository.claim(tx, invitation.id, tokenHash))) {
          throw invalid();
        }
        if (!(await this.tenants.isActive(tx, tenantId))) throw invalid();
        const grant = await this.revalidate(tx, invitation);

        const userId = account
          ? account.id
          : (
              await this.accounts.create(tx, {
                name: newAccount!.name,
                email: invitation.email,
                passwordHash: newAccount!.passwordHash,
                lastTenantId: tenantId,
              })
            ).id;
        if (account) await this.accounts.markEmailVerified(tx, userId);

        const existing = await this.memberships.findByEmail(
          invitation.email,
          tx,
        );
        if (existing) {
          throw new ConflictException({
            code:
              existing.status === 'active'
                ? 'ALREADY_MEMBER'
                : 'MEMBERSHIP_INACTIVE',
            message: 'Bu mağazada zaten bir üyeliğiniz var',
          });
        }
        await this.memberships.create(tx, userId);
        if (grant.tenantRole) {
          const roleId = invitation.tenantRoleId;
          if (!roleId) throw invalid();
          await this.access.assignTenantRole(tx, userId, roleId);
        }
        if (grant.companyRoles.length > 0) {
          await this.access.assignCompanyRoles(
            tx,
            userId,
            grant.companyRoles.map(({ companyId, roleId }) => ({
              companyId,
              roleId,
            })),
          );
        }
        await this.repository.setAcceptedBy(tx, invitation.id, userId);
        await this.recordAccepted(tx, invitation, userId, grant);

        const tenant = await this.tenants.profile(tx, tenantId);
        return { tenantId, tenantName: tenant?.name ?? '' };
      }),
    );
  }

  // ---- Internals --------------------------------------------------------

  /** Exactly one of tenantRole and companyRoles (at least one company). */
  private requestedKeys(dto: CreateInvitationDto): { roleKey: RoleKey }[] {
    const hasTenant = dto.tenantRole !== undefined;
    const hasCompany = dto.companyRoles !== undefined;
    if (hasTenant === hasCompany) {
      throw new BadRequestException({
        code: 'ROLE_REQUIRED',
        message: 'Ya Admin rolü ya da firma rolleri seçilmeli',
      });
    }
    if (hasTenant) return [{ roleKey: dto.tenantRole! }];
    if (dto.companyRoles!.length === 0) {
      throw new BadRequestException({
        code: 'COMPANY_REQUIRED',
        message: 'Firma rolü için en az bir firma seçilmeli',
      });
    }
    return dto.companyRoles!;
  }

  /** The actor's tenant role is read from the database, not from the JWT. */
  private async assertGrantable(actorId: string, keys: RoleKey[]) {
    const actorKey = await this.access.tenantRoleKey(actorId);
    if (!actorKey || !keys.every((k) => canGrant(actorKey, k))) {
      throw notGrantable();
    }
  }

  /** A pending invitation of this tenant the actor could have created. */
  private async pendingForActor(actor: AuthUser, id: string) {
    const invitation = await this.repository.findById(id);
    if (!invitation) throw notFound();
    if (invitation.status !== 'pending') throw notPending();
    const keys = await this.access.roleKeysByIds(this.roleIdsOf(invitation));
    const requested = this.roleIdsOf(invitation).map((rid) => keys.get(rid));
    if (requested.some((k) => !k)) throw notGrantable();
    await this.assertGrantable(actor.sub, requested as RoleKey[]);
    return invitation;
  }

  private roleIdsOf(invitation: InvitationRow): string[] {
    return [
      ...(invitation.tenantRoleId ? [invitation.tenantRoleId] : []),
      ...invitation.companyRoles.map((c) => c.roleId),
    ];
  }

  /**
   * Inside accept's transaction: the inviter is still an active member who may
   * grant every role, and at least one invited company is still active
   * (inactive ones are skipped). Otherwise the invitation is invalid.
   */
  private async revalidate(
    tx: PrismaTx,
    invitation: InvitationRow,
  ): Promise<Grant> {
    const inviter = await this.memberships.lockActive(
      tx,
      invitation.tenantId,
      invitation.invitedByUserId,
    );
    if (inviter === null) throw invalid();
    const inviterKey = await this.access.tenantRoleKey(
      invitation.invitedByUserId,
      tx,
    );
    const keys = await this.access.roleKeysByIds(
      this.roleIdsOf(invitation),
      tx,
    );
    const grantable = (roleId: string) => {
      const key = keys.get(roleId);
      return key && inviterKey && canGrant(inviterKey, key) ? key : null;
    };

    if (invitation.tenantRoleId) {
      const key = grantable(invitation.tenantRoleId);
      if (!key) throw invalid();
      return { tenantRole: key, companyRoles: [] };
    }
    const roles = invitation.companyRoles.map((c) => ({
      ...c,
      roleKey: grantable(c.roleId),
    }));
    if (roles.length === 0 || roles.some((r) => !r.roleKey)) throw invalid();
    const active = new Set(
      (
        await this.companies.activeByIds(
          roles.map((r) => r.companyId),
          tx,
        )
      ).map((c) => c.id),
    );
    const kept = roles.filter((r) => active.has(r.companyId));
    if (kept.length === 0) throw invalid();
    return {
      tenantRole: null,
      companyRoles: kept.map((r) => ({
        companyId: r.companyId,
        roleId: r.roleId,
        roleKey: r.roleKey!,
      })),
    };
  }

  private async recordAccepted(
    tx: PrismaTx,
    invitation: InvitationRow,
    userId: string,
    grant: Grant,
  ) {
    const base = { module: MODULE, actorUserId: userId };
    await this.audit.record(
      {
        ...base,
        action: 'INVITATION_ACCEPTED',
        entityType: ENTITY,
        entityId: invitation.id,
        before: { status: 'pending' },
        after: { status: 'accepted', userId },
      },
      tx,
    );
    await this.audit.record(
      {
        ...base,
        action: 'MEMBERSHIP_CREATED',
        entityType: 'TenantMembership',
        entityId: userId,
        after: { userId, status: 'active', invitationId: invitation.id },
      },
      tx,
    );
    if (grant.tenantRole) {
      await this.audit.record(
        {
          ...base,
          action: 'ROLE_CHANGED',
          entityType: 'TenantMembership',
          entityId: userId,
          before: { tenantRole: null },
          after: { tenantRole: grant.tenantRole },
        },
        tx,
      );
    } else {
      await this.audit.record(
        {
          ...base,
          action: 'COMPANY_ACCESS_CHANGED',
          entityType: 'TenantMembership',
          entityId: userId,
          after: {
            added: grant.companyRoles.map(({ companyId, roleKey }) => ({
              companyId,
              roleKey,
            })),
          },
        },
        tx,
      );
    }
  }

  /** "Admin" or "Muhasebe — Örnek A.Ş., ..." over active companies; null if none is left. */
  private async summary(invitation: InvitationRow): Promise<string | null> {
    const keys = await this.access.roleKeysByIds(this.roleIdsOf(invitation));
    if (invitation.tenantRoleId) {
      const key = keys.get(invitation.tenantRoleId);
      return key ? ROLE_CATALOG[key].name : null;
    }
    const names = new Map(
      (
        await this.companies.activeByIds(
          invitation.companyRoles.map((c) => c.companyId),
        )
      ).map((c) => [c.id, c.legalName]),
    );
    const parts = invitation.companyRoles.flatMap((c) => {
      const key = keys.get(c.roleId);
      const name = names.get(c.companyId);
      return key && name ? [`${ROLE_CATALOG[key].name} — ${name}`] : [];
    });
    return parts.length > 0 ? parts.join(', ') : null;
  }

  private validateNewAccount(dto: AcceptInvitationDto): string {
    const name = dto.name?.trim() ?? '';
    const details: { field: string; message: string }[] = [];
    if (name.length < 2 || name.length > 100) {
      details.push({ field: 'name', message: 'Ad 2–100 karakter olmalı' });
    }
    if (dto.password.length < 8) {
      details.push({
        field: 'password',
        message: 'Şifre en az 8 karakter olmalı',
      });
    }
    if (details.length > 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Girdi doğrulanamadı',
        details,
      });
    }
    return name;
  }

  /**
   * Tenant context. Sends the link and records the outcome on the row. Never
   * throws: a failure is reported as `delivery: 'failed'`.
   */
  private async deliver(
    tenantId: string,
    invitation: Pick<
      InvitationRow,
      'id' | 'email' | 'invitedByUserId' | 'expiresAt'
    >,
    token: string,
  ): Promise<Delivery> {
    let error: string | null = null;
    try {
      const full = await this.repository.findById(invitation.id);
      const [tenant, inviter, summary] = await Promise.all([
        this.tenants.profile(this.repository.prisma, tenantId),
        this.memberships.get(tenantId, invitation.invitedByUserId),
        full ? this.summary(full) : null,
      ]);
      await this.mail.send({
        to: invitation.email,
        ...invitationMail({
          tenantName: tenant?.name ?? '',
          inviterName: inviter?.user.name ?? '',
          roleSummary: summary ?? '',
          url: `${this.config.appOrigin}/invite/${token}`,
          expiresAt: invitation.expiresAt,
        }),
      });
    } catch (e) {
      error = e instanceof MailDeliveryError ? e.code : 'SMTP_UNAVAILABLE';
      if (!(e instanceof MailDeliveryError)) {
        this.logger.error(
          `Davet e-postası hazırlanamadı (${invitation.id}): ${(e as Error).name}`,
        );
      }
    }
    await this.repository.recordSend(invitation.id, error);
    return error ? 'failed' : 'sent';
  }
}
