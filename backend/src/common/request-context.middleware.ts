import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context.js';

/** A caller-supplied id is kept only if it is short and harmless (no log injection). */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = requestIdFrom(req.headers['x-request-id']);
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    RequestContext.enter(
      { ipAddress: req.ip, userAgent: req.get('user-agent'), requestId },
      () => {
        // One access line per request; the path without its query string (may carry tokens).
        res.on('finish', () => {
          const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
          const path = (req.originalUrl ?? req.url).split('?')[0];
          this.logger.log(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
        });
        next();
      },
    );
  }
}
