import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../common/request-context.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import {
  type AuthenticatedRequest,
  IS_PUBLIC,
  PERMISSIONS,
} from './decorators.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { type AccessTokenPayload, TokenService } from './token.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global. Verifies the access token, checks that its membership is still
 * active in an active tenant with the same auth_version (401 SESSION_REVOKED /
 * TOKEN_STALE), and binds its tenant to the request context.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly memberships: MembershipsRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Kimlik doğrulanmadı');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.tokens.verifyAccess(token);
      if (!UUID.test(payload.sub) || !UUID.test(payload.tid)) {
        throw new Error('Geçersiz token kimliği');
      }
    } catch {
      throw new UnauthorizedException('Geçersiz veya süresi dolmuş token');
    }

    // Every request re-reads the membership, so deactivation and role
    // changes take effect immediately instead of when the token expires.
    const state = await this.memberships.sessionState(payload.tid, payload.sub);
    if (!state?.usable) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Oturum sonlandırıldı',
      });
    }
    if (payload.ver !== state.authVersion) {
      throw new UnauthorizedException({
        code: 'TOKEN_STALE',
        message: 'Oturum bilgileri güncellenmeli',
      });
    }
    req.user = {
      sub: payload.sub,
      tid: payload.tid,
      perms: payload.perms,
      ver: payload.ver,
    };

    TenantContext.setTenant(req.user.tid);
    RequestContext.setUser(req.user.sub);
    return true;
  }
}

/** Global. Checks @RequirePermissions against the permissions in the access token. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const perms = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
      .user?.perms;
    if (!perms) throw new ForbiddenException('Yetki yok');
    if (perms.includes('*')) return true;
    if (!required.every((p) => perms.includes(p))) {
      throw new ForbiddenException('Yetki yok');
    }
    return true;
  }
}
