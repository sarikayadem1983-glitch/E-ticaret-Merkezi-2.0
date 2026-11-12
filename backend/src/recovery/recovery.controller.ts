import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Post,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { type AuthUser, CurrentUser, Public } from '../auth/decorators.js';
import { accountKey, ipBucket } from '../rate-limit/client-key.js';
import {
  AUTH_RATE_LIMITS,
  type AuthRateLimits,
} from '../rate-limit/rate-limit.config.js';
import { RateLimitedException } from '../rate-limit/rate-limit.errors.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';
import { RecoveryService } from './recovery.service.js';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ForgotPasswordDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 100)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(20, 100)
  token!: string;
}

const ACCEPTED = {
  data: {
    message:
      'Bu adrese kayıtlı bir hesap varsa şifre sıfırlama bağlantısı gönderildi.',
  },
};

/** USR-19 endpoints under /auth. Public ones are rate limited per IP (and per account). */
@Controller('auth')
export class RecoveryController {
  constructor(
    private readonly recovery: RecoveryService,
    private readonly limiter: RateLimiterService,
    @Inject(AUTH_RATE_LIMITS) private readonly limits: AuthRateLimits,
  ) {}

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    await this.limiter.hit(
      `forgot:ip:${ipBucket(ip)}`,
      this.limits.passwordForgotPerIp,
    );
    // Per address: limit reached → same answer, no e-mail (no enumeration, no mail bombing).
    try {
      await this.limiter.hit(
        `forgot:acct:${accountKey(dto.email)}`,
        this.limits.passwordForgotPerAccount,
      );
    } catch (error) {
      if (error instanceof RateLimitedException) return ACCEPTED;
      throw error;
    }
    this.recovery.requestPasswordReset(dto.email);
    return ACCEPTED;
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    await this.limiter.hit(
      `reset:ip:${ipBucket(ip)}`,
      this.limits.tokenUsePerIp,
    );
    await this.recovery.resetPassword(dto.token, dto.password);
  }

  @Post('email/verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestVerification(@CurrentUser() user: AuthUser) {
    await this.limiter.hit(
      `verify:user:${user.sub}`,
      this.limits.passwordForgotPerAccount,
    );
    await this.recovery.requestEmailVerification(user.sub);
    return { data: { message: 'Doğrulama bağlantısı gönderildi.' } };
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verify(@Body() dto: VerifyEmailDto, @Ip() ip: string) {
    await this.limiter.hit(
      `verify:ip:${ipBucket(ip)}`,
      this.limits.tokenUsePerIp,
    );
    await this.recovery.verifyEmail(dto.token);
  }
}
