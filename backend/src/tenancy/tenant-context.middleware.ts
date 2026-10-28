import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context.js';

/** Gives every request an empty tenant store; queries fail until auth binds a tenant. */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction) {
    TenantContext.enter(next);
  }
}
