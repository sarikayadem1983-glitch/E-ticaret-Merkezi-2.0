import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import {
  TenantContextMissingError,
  TenantViolationError,
} from '../tenancy/tenant.errors.js';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  426: 'HTTPS_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

interface ErrorBody {
  code: string;
  message: string;
  details: unknown[];
}

const GENERIC_SERVER_ERROR: ErrorBody = {
  code: 'INTERNAL_ERROR',
  message: 'Sunucu hatası',
  details: [],
};

/** Errors thrown by body-parser/express before Nest sees the request. */
interface HttpLikeError {
  status: number;
  expose: boolean;
  type?: string;
}

function isHttpLikeError(value: unknown): value is HttpLikeError {
  return (
    value instanceof Error &&
    typeof (value as Partial<HttpLikeError>).status === 'number' &&
    (value as Partial<HttpLikeError>).expose === true
  );
}

const BODY_ERROR_MESSAGES: Record<string, string> = {
  'entity.too.large': 'İstek gövdesi izin verilen boyutu aşıyor',
  'entity.parse.failed': 'İstek gövdesi geçerli JSON değil',
  'encoding.unsupported': 'Desteklenmeyen karakter kodlaması',
  'charset.unsupported': 'Desteklenmeyen karakter seti',
};

/** Express error middleware for body-parser failures (size, malformed JSON, charset). */
export function bodyParserErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isHttpLikeError(err)) return next(err);
  res.status(err.status).json({
    error: {
      code: STATUS_CODES[err.status] ?? 'BAD_REQUEST',
      message: BODY_ERROR_MESSAGES[err.type ?? ''] ?? 'Geçersiz istek',
      details: [],
    },
  });
}

/**
 * Maps every error to the standard `{ error: { code, message, details } }` shape.
 * In production, 5xx responses never carry internal messages or codes.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly production = false) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, error] = this.toError(exception);
    const body =
      this.production && status >= 500
        ? {
            ...GENERIC_SERVER_ERROR,
            code: STATUS_CODES[status] ?? 'INTERNAL_ERROR',
          }
        : error;
    res.status(status).json({ error: body });
  }

  private toError(exception: unknown): [number, ErrorBody] {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const custom =
        typeof body === 'object' ? (body as Partial<ErrorBody>) : {};
      return [
        status,
        {
          code: custom.code ?? STATUS_CODES[status] ?? 'ERROR',
          message: custom.message ?? exception.message,
          details: custom.details ?? [],
        },
      ];
    }

    if (isHttpLikeError(exception)) {
      return [
        exception.status,
        {
          code: STATUS_CODES[exception.status] ?? 'BAD_REQUEST',
          message:
            BODY_ERROR_MESSAGES[exception.type ?? ''] ?? 'Geçersiz istek',
          details: [],
        },
      ];
    }

    if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      return [
        HttpStatus.CONFLICT,
        { code: 'CONFLICT', message: 'Kayıt zaten mevcut', details: [] },
      ];
    }

    if (
      exception instanceof TenantContextMissingError ||
      exception instanceof TenantViolationError
    ) {
      this.logger.error(exception.message, exception.stack);
      return [
        HttpStatus.INTERNAL_SERVER_ERROR,
        { code: exception.code, message: 'Sunucu hatası', details: [] },
      ];
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return [HttpStatus.INTERNAL_SERVER_ERROR, GENERIC_SERVER_ERROR];
  }
}
