import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import {
  CHANNEL_RATE_POLICIES,
  ChannelRateLimiter,
  ratePolicies,
} from './channel-rate-limiter.js';
import { ExternalRefsRepository } from './external-refs.repository.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

/** INT-02 sync engine. Marketplace modules import it and register their kinds. */
@Module({
  imports: [ChannelsModule, RateLimitModule],
  controllers: [SyncController],
  providers: [
    // Parsed once at startup: an invalid SYNC_RATE_* value stops the app.
    {
      provide: CHANNEL_RATE_POLICIES,
      useFactory: () => ratePolicies(process.env),
    },
    ChannelRateLimiter,
    ExternalRefsRepository,
    SyncService,
  ],
  exports: [SyncService],
})
export class SyncModule {}
