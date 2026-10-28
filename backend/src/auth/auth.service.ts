import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
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
        await this.recordLoginFailed(user.id, 'invalid_password');
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
      if (stored.revokedAt) {
        // Reuse of a rotated token: assume it leaked and end every session.
        await this.repository.revokeAllForUser(stored.userId);
        await this.recordTokenReuse(stored.userId);
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
      const rotated = await prisma.$transaction(async (tx) => {
        const created = await this.repository.createRefreshToken(tx, {
          userId: stored.userId,
          tokenHash: next.hash,
          expiresAt: next.expiresAt,
        });
        return this.repository.revokeRefreshToken(tx, stored.id, created.id);
      });
      if (!rotated) {
        // Lost a race with a concurrent refresh of the same token: treat as reuse.
        await this.repository.revokeAllForUser(stored.userId);
        await this.recordTokenReuse(stored.userId);
        throw invalidRefreshToken();
      }

      const perms = await this.repository.findPermissions(stored.userId);
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
    reason: 'invalid_password' | 'membership_inactive' | 'tenant_inactive',
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

  private recordTokenReuse(userId: string) {
    return this.audit.record({
      action: 'TOKEN_REUSE_DETECTED',
      module: MODULE,
      entityType: 'User',
      entityId: userId,
      after: { revokedAllSessions: true },
      actorUserId: null,
    });
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

    const active = await this.memberships.findActiveForUser(current.sub);
    if (!active.some((m) => m.tenantId === targetTenantId)) {
      throw tenantNotFound();
    }

    return TenantContext.run(targetTenantId, async () => {
      const membership = await this.memberships.get(
        targetTenantId,
        current.sub,
      );
      if (membership?.status !== 'active') throw tenantNotFound();

      const event: AuditEvent = {
        action: 'TENANT_SWITCH',
        module: MODULE,
        entityType: 'User',
        entityId: current.sub,
        after: { fromTenantId: current.tid, toTenantId: targetTenantId },
        actorUserId: current.sub,
      };
      const next = this.tokens.newRefreshToken();
      const switched = await this.repository.prisma.$transaction(async (tx) => {
        const revoked = await TenantContext.run(current.tid, async () => {
          if (
            !(await this.repository.revokeRefreshToken(tx, stored.id, null))
          ) {
            return false;
          }
          await this.audit.record(event, tx);
          return true;
        });
        // Used concurrently by another request: nothing is issued.
        if (!revoked) return false;
        await this.repository.createRefreshToken(tx, {
          userId: current.sub,
          tokenHash: next.hash,
          expiresAt: next.expiresAt,
        });
        await this.audit.record(event, tx);
        return true;
      });
      if (!switched) throw invalidRefreshToken();

      await TenantContext.runAsSystem(() =>
        this.repository.setLastTenant(current.sub, targetTenantId),
      );
      const perms = await this.repository.findPermissions(current.sub);
      return this.issueAccess(
        {
          tenantId: targetTenantId,
          userId: current.sub,
          ver: membership.authVersion,
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
    const perms = await this.repository.findPermissions(session.userId);
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
