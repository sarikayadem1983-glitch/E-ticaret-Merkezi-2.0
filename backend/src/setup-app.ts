import type { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { validationPipe } from './common/validation.pipe.js';

/** Shared by main.ts and e2e tests so both run the same pipeline. */
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new HttpExceptionFilter());
}
