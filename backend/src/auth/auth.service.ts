import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AccessService } from '../access/access.service.js';
import { ROLE_CATALOG } from '../access/roles.catalog.js';
import { type AuditEvent, AuditService } from '../audit/audit.service.js';
import {
  type ActiveMembership,
  type LoginMembership,
  MembershipsRepository,
} from '../memberships/memberships.repository.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantsService } from '../tenants/tenants.service.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';
import type { AuthUser } from './decorators.js';
import { AuthRepository } from './auth.repository.js';
import { type DisabledReason, disabledReason } from './user-state.js';
import { TokenService, type TokenPair } from './token.service.js';

const MODULE = 'auth';

/** Verified against when the email is unknown, so response time does not reveal which emails exist. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$k64vcPJe/wujm0zOZjSf7Q$ByIDorJvL/RYwKH5NhGhrmAuiob8Xb8wdk7OLWtBypo';

interface Session {
  tenantId: string;
  userId: string;
  /** The membership's auth_version, issued as the token's ver claim. */
  ver: number;
}

/** last_tenant_id when it is still an active store, else the first by tenant name. */
function pickTenant(
  active: ActiveMembership[],
  lastTenantId: string | null,
): ActiveMembership | undefined {
  return active.find((m) => m.tenantId === lastTenantId) ?? active[0];
}

/**
 * Tenant to record a failed login in when no store is usable: last_tenant_id's
 * membership if it exists, else the most recently changed one.
 */
function relevantMembership(
  all: LoginMembership[],
  lastTenantId: string | null,
): LoginMembership | undefined {
  return (
    all.find((m) => m.tenantId === lastTenantId) ??
    [...all].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())[0]
  );
}

// Safety bound only: 8 statements, measured worst case 0.72 s (task-4 report).
const REGISTER_TX_OPTIONS = { timeout: 10_000 };

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function invalidCredentials() {
  return new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'Email veya şifre hatalı',
  });
}

/** Another request revoked the token first; thrown to roll back the transaction. */
class LostRotationRace extends Error {}

function nullOnLostRace(error: unknown): null {
  if (error instanceof LostRotationRace) return null;
  throw error;
}

function tenantNotFound() {
  return new NotFoundException({
    code: 'TENANT_NOT_FOUND',
    message: 'Mağaza bulunamadı',
  });
}

function invalidRefreshToken() {
  return new UnauthorizedException({
    code: 'INVALID_REFRESH_TOKEN',
    message: 'Oturum geçersiz, tekrar giriş yapın',
  });
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly tenants: TenantsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly memberships: MembershipsRepository,
    private readonly access: AccessService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    // CPU-heavy and non-database work stays outside the transaction.
    const passwordHash = await hash(dto.password);
    const refresh = this.tokens.newRefreshToken();
    const prisma = this.repository.prisma;

    // The tenant and the global user are created in system context; everything
    // the tenant owns is written in the new tenant's context.
    const session = await TenantContext.runAsSystem(() =>
      prisma.$transaction(async (tx) => {
        const tenant = await this.tenants.create(tx, {
          name: dto.tenantName,
          slug: dto.tenantSlug,
        });
        const user = await this.repository.createUser(tx, {
          name: dto.name,
          email: dto.email,
          passwordHash,
          lastTenantId: tenant.id,
        });
        return TenantContext.run(tenant.id, async (): Promise<Session> => {
          const membership = await this.memberships.create(tx, user.id);
          const roles = await this.repository.createSystemRoles(tx);
          const owner = roles.find((r) => r.key === 'owner');
          if (!owner) throw new Error('owner rolü oluşturulamadı');
          await this.repository.assignRole(tx, user.id, owner.id);
          await this.audit.record(
            {
              action: 'CREATE',
              module: 'tenants',
              entityType: 'Tenant',
              entityId: tenant.id,
              after: { name: dto.tenantName, slug: dto.tenantSlug },
              actorUserId: user.id,
            },
            tx,
          );
          await this.audit.record(
            {
              action: 'CREATE',
              module: MODULE,
              entityType: 'User',
              entityId: user.id,
              after: { name: dto.name, email: dto.email, roles: ['owner'] },
              actorUserId: user.id,
            },
            tx,
          );
          await this.repository.createRefreshToken(tx, {
            userId: user.id,
            tokenHash: refresh.hash,
            expiresAt: refresh.expiresAt,
          });
          return {
            tenantId: tenant.id,
            userId: user.id,
            ver: membership.authVersion,
          };
        });
      }, REGISTER_TX_OPTIONS),
    );

    return this.issueAccess(
      session,
      [...ROLE_CATALOG.owner.permissions],
      refresh.token,
    );
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await TenantContext.runAsSystem(() =>
      this.repository.findUserForLogin(dto.email),
    );
    // Always one membership query, also for an unknown email, so both paths
    // run the same queries before the (constant-cost) password check.
    const memberships = await this.memberships.findAllForUser(
      user?.id ?? NIL_UUID,
    );
    const passwordOk = await verify(
      user?.passwordHash ?? DUMMY_HASH,
      dto.password,
    );
    // Unknown email: no tenant to attribute the event to, so it is not audited.
    if (!user) throw invalidCredentials();

    // Deactivated or soft-deleted account: same response as a wrong password
    // (the hash was still verified above, so timing matches). Audited in the
    // background in the most relevant tenant, reason code only.
    const disabled = disabledReason(user);
    if (disabled) {
      const relevant = relevantMembership(memberships, user.lastTenantId);
      if (relevant) {
        const reason = passwordOk ? disabled : 'invalid_password';
        void TenantContext.run(relevant.tenantId, () =>
          this.recordLoginFailed(user.id, reason),
        );
      }
      throw invalidCredentials();
    }

    const active = memberships.filter((m) => m.active && m.tenantActive);
    const target = pickTenant(active, user.lastTenantId);
    if (!target) {
      // Same response as an unknown email. The audit row is written in the
      // background so the response time does not reveal that the account exists.
      const relevant = relevantMembership(memberships, user.lastTenantId);
      if (relevant) {
        const reason = !passwordOk
          ? 'invalid_password'
          : !relevant.active
            ? 'membership_inactive'
            : 'tenant_inactive';
        void TenantContext.run(relevant.tenantId, () =>
          this.recordLoginFailed(user.id, reason),
        );
      }
      throw invalidCredentials();
    }

    return TenantContext.run(target.tenantId, async () => {
      if (!passwordOk) {
        // Background, like the unknown/disabled paths: the response time must
        // not reveal whether the account is active.
        void this.recordLoginFailed(user.id, 'invalid_password');
        throw invalidCredentials();
      }

      // Read in the tenant's context: the membership row carries auth_version.
      const membership = await this.memberships.get(target.tenantId, user.id);
      if (membership?.status !== 'active') {
        // Deactivated between the lookup and now.
        await this.recordLoginFailed(user.id, 'membership_inactive');
        throw invalidCredentials();
      }

      await TenantContext.runAsSystem(() =>
        this.repository.touchLastLogin(user.id, target.tenantId),
      );
      await this.audit.record({
        action: 'LOGIN',
        module: MODULE,
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
      });
      return this.startSession({
        tenantId: target.tenantId,
        userId: user.id,
        ver: membership.authVersion,
      });
    });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const stored = await TenantContext.runAsSystem(() =>
      this.repository.findRefreshToken(TokenService.hash(refreshToken)),
    );
    if (!stored) throw invalidRefreshToken();

    return TenantContext.run(stored.tenantId, async () => {
      // Checked before reuse detection: a deactivated or deleted user's token
      // is revoked and refused, and presenting it again is not treated as theft.
      const account = await TenantContext.runAsSystem(() =>
        this.repository.findUserState(stored.userId),
      );
      if (!account || disabledReason(account)) {
        if (!stored.revokedAt) {
          await this.repository.revokeRefreshToken(
            this.repository.prisma,
            stored.id,
            null,
          );
        }
        throw invalidRefreshToken();
      }
      if (stored.revokedAt) {
        // Only rotation sets replacedById. A token revoked without a successor
        // (logout, bulk revocation) is refused without the reuse alarm.
        if (stored.replacedById) {
          // Reuse of a rotated token: assume it leaked and end every session.
          await this.handleTokenReuse(stored.userId, stored.tenantId);
        }
        throw invalidRefreshToken();
      }
      if (stored.expiresAt <= new Date()) throw invalidRefreshToken();

      const prisma = this.repository.prisma;
      const membership = await this.memberships.get(
        stored.tenantId,
        stored.userId,
      );
      if (
        membership?.status !== 'active' ||
        !(await this.tenants.isActive(prisma, stored.tenantId))
      ) {
        throw invalidRefreshToken();
      }

      const next = this.tokens.newRefreshToken();
      const rotated = await prisma
        .$transaction(async (tx) => {
          const created = await this.repository.createRefreshToken(tx, {
            userId: stored.userId,
            tokenHash: next.hash,
            expiresAt: next.expiresAt,
          });
          // Lost the race: throw so the new token is rolled back, not left
          // active without ever reaching a client.
          if (
            !(await this.repository.revokeRefreshToken(
              tx,
              stored.id,
              created.id,
            ))
          ) {
            throw new LostRotationRace();
          }
          return true;
        })
        .catch(nullOnLostRace);
      if (!rotated) {
        // Lost a race with a concurrent refresh of the same token: treat as reuse.
        await this.handleTokenReuse(stored.userId, stored.tenantId);
        throw invalidRefreshToken();
      }

      const perms = await this.access.tenantPermissions(
        stored.tenantId,
        stored.userId,
      );
      return this.issueAccess(
        {
          tenantId: stored.tenantId,
          userId: stored.userId,
          ver: membership.authVersion,
        },
        perms,
        next.token,
      );
    });
  }

  /** Runs in the authenticated request's tenant context. */
  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.repository.revokeByHash(userId, TokenService.hash(refreshToken));
    await this.audit.record({
      action: 'LOGOUT',
      module: MODULE,
      entityType: 'User',
      entityId: userId,
    });
  }

  /**
   * Never throws: a failed audit write must not change what the client sees
   * (still the generic invalid-credentials error, never a 500). The failure is
   * logged without the submitted credentials.
   */
  private async recordLoginFailed(
    userId: string,
    reason:
      | 'invalid_password'
      | 'membership_inactive'
      | 'tenant_inactive'
      | DisabledReason,
  ): Promise<void> {
    try {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        module: MODULE,
        entityType: 'User',
        entityId: userId,
        after: { reason },
        actorUserId: null,
      });
    } catch (error) {
      this.logger.error(
        `LOGIN_FAILED audit kaydı yazılamadı (${reason}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Ends every session of the user in every tenant: all unrevoked refresh
   * tokens are revoked and auth_version is bumped on all memberships, in one
   * transaction in system context (both queries filter by userId). If it
   * fails the error propagates (500, no token issued) and nothing is audited
   * as done. After commit, one TOKEN_REUSE_DETECTED row is written into each
   * affected tenant (always including the detecting one) with that tenant's
   * revoked count; an audit failure is logged and does not undo the
   * revocation or change the 401.
   */
  private async handleTokenReuse(
    userId: string,
    detectedInTenantId: string,
  ): Promise<void> {
    let revoked: { tenantId: string; count: number }[];
    let bumped: string[];
    try {
      ({ revoked, bumped } = await TenantContext.runAsSystem(() =>
        this.repository.prisma.$transaction(async (tx) => {
          const revoked = await TenantContext.runAsSystem(() =>
            this.repository.revokeAllForUserEverywhere(tx, userId),
          );
          const bumped = await this.memberships.bumpAuthVersionForUser(
            tx,
            userId,
          );
          return { revoked, bumped };
        }),
      ));
    } catch (error) {
      this.logger.error(
        `Refresh token tekrar kullanımı: oturumlar iptal EDİLEMEDİ (user ${userId}): ${(error as Error).message}`,
      );
      throw error;
    }

    const perTenant = new Map(revoked.map((r) => [r.tenantId, r.count]));
    const affectedTenantIds = [
      ...new Set([detectedInTenantId, ...bumped, ...perTenant.keys()]),
    ];
    const totalRefreshRevokedCount = revoked.reduce((n, r) => n + r.count, 0);
    for (const tenantId of affectedTenantIds) {
      try {
        await TenantContext.run(tenantId, () =>
          this.audit.record({
            action: 'TOKEN_REUSE_DETECTED',
            module: MODULE,
            entityType: 'User',
            entityId: userId,
            after: {
              detectedInTenantId,
              refreshRevokedCount: perTenant.get(tenantId) ?? 0,
              accessRevoked: bumped.includes(tenantId),
              totalRefreshRevokedCount,
              affectedTenantIds,
            },
            actorUserId: null,
          }),
        );
      } catch (error) {
        this.logger.error(
          `TOKEN_REUSE_DETECTED audit kaydı yazılamadı (tenant ${tenantId}): ${(error as Error).message}`,
        );
      }
    }
  }

  /** The user's active stores in active tenants, marking the current one. */
  async listMemberships(userId: string, currentTenantId: string) {
    const active = await this.memberships.findActiveForUser(userId);
    return active.map((m) => ({
      tenantId: m.tenantId,
      name: m.tenantName,
      slug: m.tenantSlug,
      current: m.tenantId === currentTenantId,
    }));
  }

  /**
   * Moves the session to another store. The caller's refresh token must be an
   * active token of this user in the current tenant; it is revoked and a new
   * one is issued for the target membership. Claims (tid, perms, ver) come
   * only from the target membership. Without an active membership in an
   * active target tenant: 404, nothing is revoked or issued.
   */
  async switchTenant(
    current: AuthUser,
    targetTenantId: string,
    refreshToken: string,
  ): Promise<TokenPair> {
    const stored = await TenantContext.runAsSystem(() =>
      this.repository.findRefreshToken(TokenService.hash(refreshToken)),
    );
    if (
      !stored ||
      stored.userId !== current.sub ||
      stored.tenantId !== current.tid ||
      stored.revokedAt ||
      stored.expiresAt <= new Date()
    ) {
      throw invalidRefreshToken();
    }

    if (targetTenantId === current.tid) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Zaten bu mağazadasınız',
      });
    }

    const active = await this.memberships.findActiveForUser(current.sub);
    if (!active.some((m) => m.tenantId === targetTenantId)) {
      throw tenantNotFound();
    }

    return TenantContext.run(targetTenantId, async () => {
      const event: AuditEvent = {
        action: 'TENANT_SWITCH',
        module: MODULE,
        entityType: 'User',
        entityId: current.sub,
        after: { fromTenantId: current.tid, toTenantId: targetTenantId },
        actorUserId: current.sub,
      };
      const next = this.tokens.newRefreshToken();
      // Throws 404 inside the transaction so nothing is revoked or issued.
      const switched = await this.repository.prisma
        .$transaction(async (tx) => {
          const ver = await this.memberships.lockActive(
            tx,
            targetTenantId,
            current.sub,
          );
          if (ver === null) throw tenantNotFound();
          const created = await this.repository.createRefreshToken(tx, {
            userId: current.sub,
            tokenHash: next.hash,
            expiresAt: next.expiresAt,
          });
          const revoked = await TenantContext.run(current.tid, async () => {
            // The successor marks this as a rotation: replaying the old token
            // raises the reuse alarm.
            if (
              !(await this.repository.revokeRefreshToken(
                tx,
                stored.id,
                created.id,
              ))
            ) {
              return false;
            }
            // The old store's access tokens die with the switch (TOKEN_STALE);
            // the user's other devices there refresh once and continue.
            await this.memberships.bumpAuthVersion(
              tx,
              current.tid,
              current.sub,
            );
            await this.audit.record(event, tx);
            return true;
          });
          // Used concurrently by another request: roll back so nothing is issued.
          if (!revoked) throw new LostRotationRace();
          await this.audit.record(event, tx);
          return { ver };
        })
        .catch(nullOnLostRace);
      if (!switched) throw invalidRefreshToken();

      await TenantContext.runAsSystem(() =>
        this.repository.setLastTenant(current.sub, targetTenantId),
      );
      const perms = await this.access.tenantPermissions(
        targetTenantId,
        current.sub,
      );
      return this.issueAccess(
        {
          tenantId: targetTenantId,
          userId: current.sub,
          ver: switched.ver,
        },
        perms,
        next.token,
      );
    });
  }

  /** Runs in the authenticated request's tenant context; the user is read through the membership. */
  async me(tenantId: string, userId: string, permissions: string[]) {
    const membership = await this.memberships.get(tenantId, userId);
    if (membership?.status !== 'active') {
      throw new NotFoundException('Kullanıcı bulunamadı');
    }
    const tenant = await this.tenants.profile(this.repository.prisma, tenantId);
    return { ...membership.user, tenantId, tenant, permissions };
  }

  private async startSession(session: Session): Promise<TokenPair> {
    const refresh = this.tokens.newRefreshToken();
    await this.repository.createRefreshToken(this.repository.prisma, {
      userId: session.userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    const perms = await this.access.tenantPermissions(
      session.tenantId,
      session.userId,
    );
    return this.issueAccess(session, perms, refresh.token);
  }

  private async issueAccess(
    session: Session,
    perms: string[],
    refreshToken: string,
  ): Promise<TokenPair> {
    const access = await this.tokens.signAccess({
      sub: session.userId,
      tid: session.tenantId,
      perms,
      ver: session.ver,
    });
    return {
      accessToken: access.token,
      refreshToken,
      expiresIn: access.expiresIn,
    };
  }
}
