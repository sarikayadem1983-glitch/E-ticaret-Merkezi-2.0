import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { MailModule } from './mail/mail.module.js';
import { QueueModule } from './queue/queue.module.js';
import { TenantContextMiddleware } from './tenancy/tenant-context.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    CompaniesModule,
    HealthModule,
    InvitationsModule,
    // Validates mail settings at startup; production refuses log/plain SMTP.
    MailModule,
    QueueModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware, TenantContextMiddleware)
      .forRoutes('*path');
  }
}
