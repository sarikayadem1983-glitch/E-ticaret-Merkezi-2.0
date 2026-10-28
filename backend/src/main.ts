import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.get<string>('FRONTEND_URL') });
  await app.listen(config.get<number>('BACKEND_PORT') ?? 4000);
}
await bootstrap();
