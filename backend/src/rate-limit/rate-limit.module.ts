import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  AUTH_RATE_LIMITS,
  DEFAULT_AUTH_RATE_LIMITS,
} from './rate-limit.config.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { REDIS, redisProvider } from './redis.provider.js';

@Module({
  providers: [
    redisProvider,
    RateLimiterService,
    { provide: AUTH_RATE_LIMITS, useValue: DEFAULT_AUTH_RATE_LIMITS },
  ],
  exports: [RateLimiterService, AUTH_RATE_LIMITS],
})
export class RateLimitModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown() {
    this.redis.disconnect();
  }
}
