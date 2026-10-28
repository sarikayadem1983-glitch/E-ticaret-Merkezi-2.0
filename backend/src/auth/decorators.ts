import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from './token.service.js';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS = 'permissions';

/** Opts an endpoint out of authentication. Queries inside still need a tenant or runAsSystem. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires every listed permission. `*` grants all. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS, permissions);

export type AuthUser = AccessTokenPayload;

export type AuthenticatedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new Error('CurrentUser used on a public endpoint');
    return user;
  },
);
