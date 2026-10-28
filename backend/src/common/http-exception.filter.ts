import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
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
  422: 'VALIDATION_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

interface ErrorBody {
  code: string;
  message: string;
  details: unknown[];
}

/** Maps every error to the standard `{ error: { code, message, details } }` shape. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, error] = this.toError(exception);
    res.status(status).json({ error });
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
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: 'INTERNAL_ERROR', message: 'Sunucu hatası', details: [] },
    ];
  }
}
