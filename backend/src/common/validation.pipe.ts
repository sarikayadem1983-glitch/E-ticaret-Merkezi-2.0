import {
  HttpStatus,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

function flatten(errors: ValidationError[], parent = ''): object[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

export const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: (errors) =>
    new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      message: 'Girdi doğrulanamadı',
      details: flatten(errors),
    }),
});
