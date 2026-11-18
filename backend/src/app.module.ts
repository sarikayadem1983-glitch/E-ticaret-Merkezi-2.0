import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { ChannelsModule } from './channels/channels.module.js';
import { RecoveryModule } from './recovery/recovery.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { MailModule } from './mail/mail.module.js';
import { QueueModule } from './queue/queue.module.js';
import { StorageModule } from './storage/storage.module.js';
import { SyncModule } from './sync/sync.module.js';
import { UsersModule } from './users/users.module.js';
import { TenantContextMiddleware } from './tenancy/tenant-context.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    CompaniesModule,
    CatalogModule,
    OrdersModule,
    InventoryModule,
    ReportsModule,
    ImportsModule,
    DashboardModule,
    ChannelsModule,
    RecoveryModule,
    HealthModule,
    InvitationsModule,
    // Validates mail settings at startup; production refuses log/plain SMTP.
    MailModule,
    QueueModule,
    // INF-12: validates storage settings at startup; production requires a bucket.
    StorageModule,
    SyncModule,
    UsersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestContextMiddleware, TenantContextMiddleware)
      .forRoutes('*path');
  }
}
