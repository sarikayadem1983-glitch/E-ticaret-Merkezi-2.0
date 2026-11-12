import { Module } from '@nestjs/common';
import {
  INVITATIONS_CONFIG,
  loadInvitationsConfig,
} from '../invitations/invitations.config.js';
import { MailModule } from '../mail/mail.module.js';
import { MembershipsModule } from '../memberships/memberships.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { RecoveryController } from './recovery.controller.js';
import { RecoveryService } from './recovery.service.js';

/** USR-19: password reset and e-mail verification. */
@Module({
  imports: [MailModule, MembershipsModule, RateLimitModule],
  controllers: [RecoveryController],
  providers: [
    RecoveryService,
    {
      provide: INVITATIONS_CONFIG,
      useFactory: () => loadInvitationsConfig(process.env),
    },
  ],
})
export class RecoveryModule {}
