import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  setupApp(app);
  app.enableCors({ origin: config.get<string>('FRONTEND_URL') });
  await app.listen(config.get<number>('BACKEND_PORT') ?? 4000);
}
await bootstrap();
