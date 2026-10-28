import { Inject, Injectable } from '@nestjs/common';
import { accountKey, ipBucket } from '../rate-limit/client-key.js';
import {
  AUTH_RATE_LIMITS,
  type AuthRateLimits,
} from '../rate-limit/rate-limit.config.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';

/**
 * Auth endpoint limits. Keys depend only on the submitted email and the client
 * IP, never on whether the account exists, so a 429 reveals nothing about users.
 * The IP is `req.ip`, which honours X-Forwarded-For only from TRUST_PROXY peers.
 */
@Injectable()
export class AuthRateLimitService {
  constructor(
    private readonly limiter: RateLimiterService,
    @Inject(AUTH_RATE_LIMITS) private readonly limits: AuthRateLimits,
  ) {}

  /**
   * Call before checking the password. The attempt is counted up front, so
   * parallel requests cannot all pass; a successful login clears it again.
   */
  async beforeLogin(ip: string | undefined, email: string): Promise<void> {
    const client = ipBucket(ip);
    const account = accountKey(email);
    await this.limiter.hit(`login:ip:${client}`, this.limits.loginPerIp);

    const entries = [
      {
        key: `login:acct-ip:${account}:${client}`,
        policy: this.limits.loginPerAccountIp,
      },
    ];
    // An IP the owner recently logged in from is exempt from the account-wide
    // backoff, so attackers elsewhere cannot lock the owner out.
    if (!(await this.limiter.isMarked(trustedKey(account, client)))) {
      entries.push({
        key: `login:acct:${account}`,
        policy: this.limits.loginPerAccount,
      });
    }
    await this.limiter.attempt(entries);
  }

  async loginSucceeded(ip: string | undefined, email: string): Promise<void> {
    const client = ipBucket(ip);
    const account = accountKey(email);
    await this.limiter.reset(
      `login:acct-ip:${account}:${client}`,
      `login:acct:${account}`,
    );
    await this.limiter.mark(
      trustedKey(account, client),
      this.limits.trustedIpTtlMs,
    );
  }

  async beforeRegister(ip: string | undefined): Promise<void> {
    await this.limiter.hit(
      `register:ip:${ipBucket(ip)}`,
      this.limits.registerPerIp,
    );
  }

  async beforeRefresh(ip: string | undefined): Promise<void> {
    await this.limiter.hit(
      `refresh:ip:${ipBucket(ip)}`,
      this.limits.refreshPerIp,
    );
  }
}

function trustedKey(account: string, client: string): string {
  return `login:trusted:${account}:${client}`;
}
