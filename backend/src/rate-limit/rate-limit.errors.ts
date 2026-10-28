import { HttpException, HttpStatus } from '@nestjs/common';

/** Seconds a client should wait; HttpExceptionFilter sends it as `Retry-After`. */
export interface RetryAfterBody {
  code: string;
  message: string;
  retryAfter: number;
}

export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export class RateLimitedException extends HttpException {
  constructor(waitMs: number) {
    super(
      {
        code: 'TOO_MANY_REQUESTS',
        message: 'Çok fazla deneme yapıldı, lütfen daha sonra tekrar deneyin',
        retryAfter: retryAfterSeconds(waitMs),
      } satisfies RetryAfterBody,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Redis is unreachable: auth endpoints fail closed instead of running unlimited. */
export class RateLimitUnavailableException extends HttpException {
  constructor() {
    super(
      {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Servis geçici olarak kullanılamıyor',
        retryAfter: 5,
      } satisfies RetryAfterBody,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
