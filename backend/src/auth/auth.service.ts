import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AuditService } from '../audit/audit.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { TenantsService } from '../tenants/tenants.service.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';
import { AuthRepository } from './auth.repository.js';
import { TokenService, type TokenPair } from './token.service.js';

const OWNER_ROLE = { name: 'owner', permissions: ['*'] };
const MODULE = 'auth';

/** Verified against when the email is unknown, so response time does not reveal which emails exist. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$k64vcPJe/wujm0zOZjSf7Q$ByIDorJvL/RYwKH5NhGhrmAuiob8Xb8wdk7OLWtBypo';

function invalidCredentials() {
  return new UnauthorizedException({
    code: 'INVALID_CREDENTIALS',
    message: 'Email veya şifre hatalı',
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
  constructor(
    private readonly repository: AuthRepository,
    private readonly tenants: TenantsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await hash(dto.password);
    const prisma = this.repository.prisma;

    // The tenant does not exist yet, so the transaction starts in system context
    // and switches to the new tenant's context for everything it owns.
    const { tenantId, userId, refresh } = await TenantContext.runAsSystem(() =>
      prisma.$transaction(async (tx) => {
        const tenant = await this.tenants.create(tx, {
          name: dto.tenantName,
          slug: dto.tenantSlug,
        });
        return TenantContext.run(tenant.id, async () => {
          const user = await this.repository.createUser(tx, {
            name: dto.name,
            email: dto.email,
            passwordHash,
          });
          const role = await this.repository.createRole(tx, OWNER_ROLE);
          await this.repository.assignRole(tx, user.id, role.id);
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
              after: {
                name: dto.name,
                email: dto.email,
                roles: [OWNER_ROLE.name],
              },
              actorUserId: user.id,
            },
            tx,
          );
          const refresh = this.tokens.newRefreshToken();
          await this.repository.createRefreshToken(tx, {
            userId: user.id,
            tokenHash: refresh.hash,
            expiresAt: refresh.expiresAt,
          });
          return { tenantId: tenant.id, userId: user.id, refresh };
        });
      }),
    );

    return this.issueAccess(
      tenantId,
      userId,
      OWNER_ROLE.permissions,
      refresh.token,
    );
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await TenantContext.runAsSystem(() =>
      this.repository.findUserForLogin(dto.email),
    );
    const passwordOk = await verify(
      user?.passwordHash ?? DUMMY_HASH,
      dto.password,
    );
    // Unknown email: no tenant to attribute the event to, so it is not audited.
    if (!user) throw invalidCredentials();

    return TenantContext.run(user.tenantId, async () => {
      const prisma = this.repository.prisma;
      const reason = !passwordOk
        ? 'invalid_password'
        : !user.isActive
          ? 'user_inactive'
          : !(await this.tenants.isActive(prisma, user.tenantId))
            ? 'tenant_inactive'
            : null;

      if (reason) {
        await this.audit.record({
          action: 'LOGIN_FAILED',
          module: MODULE,
          entityType: 'User',
          entityId: user.id,
          after: { reason },
          actorUserId: null,
        });
        throw invalidCredentials();
      }

      await this.repository.touchLastLogin(user.id);
      await this.audit.record({
        action: 'LOGIN',
        module: MODULE,
        entityType: 'User',
        entityId: user.id,
        actorUserId: user.id,
      });
      return this.startSession(user.tenantId, user.id);
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
      const user = await this.repository.findActiveUser(stored.userId);
      if (!user || !(await this.tenants.isActive(prisma, stored.tenantId))) {
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
        stored.tenantId,
        stored.userId,
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

  async me(userId: string, permissions: string[]) {
    const user = await this.repository.findActiveUser(userId);
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    const tenant = await this.tenants.profile(
      this.repository.prisma,
      user.tenantId,
    );
    return { ...user, tenant, permissions };
  }

  private async startSession(
    tenantId: string,
    userId: string,
  ): Promise<TokenPair> {
    const refresh = this.tokens.newRefreshToken();
    await this.repository.createRefreshToken(this.repository.prisma, {
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });
    const perms = await this.repository.findPermissions(userId);
    return this.issueAccess(tenantId, userId, perms, refresh.token);
  }

  private async issueAccess(
    tenantId: string,
    userId: string,
    perms: string[],
    refreshToken: string,
  ): Promise<TokenPair> {
    const access = await this.tokens.signAccess({
      sub: userId,
      tid: tenantId,
      perms,
    });
    return {
      accessToken: access.token,
      refreshToken,
      expiresIn: access.expiresIn,
    };
  }
}
