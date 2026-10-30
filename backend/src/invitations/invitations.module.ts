import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { MailModule } from '../mail/mail.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { InvitationsRateLimitService } from './invitations-rate-limit.service.js';
import {
  INVITATIONS_CONFIG,
  loadInvitationsConfig,
} from './invitations.config.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [
    AccessModule,
    AuthModule,
    CompaniesModule,
    MailModule,
    MembershipsModule,
    RateLimitModule,
    TenantsModule,
  ],
  controllers: [InvitationsController],
  providers: [
    // process.env already holds .env (ConfigModule loads it first).
    {
      provide: INVITATIONS_CONFIG,
      useFactory: () => loadInvitationsConfig(process.env),
    },
    InvitationsRateLimitService,
    InvitationsRepository,
    InvitationsService,
  ],
})
export class InvitationsModule {}
