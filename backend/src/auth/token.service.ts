import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface AccessTokenPayload {
  sub: string;
  tid: string;
  perms: string[];
  /**
   * The membership's auth_version when the token was issued. Tokens issued before
   * memberships existed carry no `ver` and are read as 0; auth_version starts at 1,
   * so they count as stale once the guard compares versions.
   */
  ver: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const days = Number(config.get('REFRESH_TOKEN_TTL_DAYS') ?? 7);
    this.refreshTtlMs = days * 24 * 60 * 60 * 1000;
  }

  async signAccess(
    payload: AccessTokenPayload,
  ): Promise<{ token: string; expiresIn: number }> {
    const token = await this.jwt.signAsync(payload);
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(token);
    return { token, expiresIn: exp - iat };
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<
      Omit<AccessTokenPayload, 'ver'> & { ver?: unknown }
    >(token);
    const { ver } = payload;
    if (ver !== undefined && !Number.isInteger(ver)) {
      throw new Error('Geçersiz token sürümü');
    }
    return { ...payload, ver: (ver as number | undefined) ?? 0 };
  }

  /** Opaque refresh token; only its SHA-256 hash is stored. */
  newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(48).toString('base64url');
    return {
      token,
      hash: TokenService.hash(token),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
    };
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
