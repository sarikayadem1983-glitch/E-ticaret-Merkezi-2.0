import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  setupApp(app);
  const config = app.get(ConfigService);
  app.enableShutdownHooks();
  await app.listen(config.get<number>('BACKEND_PORT') ?? 4000);
}
await bootstrap();
