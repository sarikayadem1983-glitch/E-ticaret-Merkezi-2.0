import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../tenancy/tenant-context.js';
import {
  type AuthenticatedRequest,
  IS_PUBLIC,
  PERMISSIONS,
} from './decorators.js';
import { TokenService } from './token.service.js';

/** Global. Verifies the access token and binds its tenant to the request context. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
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

    try {
      const payload = await this.tokens.verifyAccess(token);
      req.user = { sub: payload.sub, tid: payload.tid, perms: payload.perms };
    } catch {
      throw new UnauthorizedException('Geçersiz veya süresi dolmuş token');
    }

    TenantContext.setTenant(req.user.tid);
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
