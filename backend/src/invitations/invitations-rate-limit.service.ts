import { Inject, Injectable } from '@nestjs/common';
import { ipBucket } from '../rate-limit/client-key.js';
import {
  AUTH_RATE_LIMITS,
  type AuthRateLimits,
} from '../rate-limit/rate-limit.config.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';

/**
 * Public invitation endpoints, per client IP. Keys never depend on the token
 * or the account, so a 429 reveals nothing.
 */
@Injectable()
export class InvitationsRateLimitService {
  constructor(
    private readonly limiter: RateLimiterService,
    @Inject(AUTH_RATE_LIMITS) private readonly limits: AuthRateLimits,
  ) {}

  beforeLookup(ip: string | undefined): Promise<void> {
    return this.limiter.hit(
      `invitation:lookup:ip:${ipBucket(ip)}`,
      this.limits.invitationLookupPerIp,
    );
  }

  beforeAccept(ip: string | undefined): Promise<void> {
    return this.limiter.hit(
      `invitation:accept:ip:${ipBucket(ip)}`,
      this.limits.invitationAcceptPerIp,
    );
  }
}
