import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import {
  AbortSwitchTenantDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  SwitchTenantDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import { type AuthUser, CurrentUser, Public } from './decorators.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limits: AuthRateLimitService,
  ) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Ip() ip: string) {
    await this.limits.beforeRegister(ip);
    return { data: await this.auth.register(dto) };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    await this.limits.beforeLogin(ip, dto.email);
    const data = await this.auth.login(dto);
    await this.limits.loginSucceeded(ip, dto.email);
    return { data };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto, @Ip() ip: string) {
    await this.limits.beforeRefresh(ip);
    return { data: await this.auth.refresh(dto.refreshToken) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshTokenDto) {
    await this.auth.logout(user.sub, dto.refreshToken);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { data: await this.auth.me(user.tid, user.sub, user.perms) };
  }

  /** The caller's active stores; `current` marks the one this token is for. */
  @Get('memberships')
  async memberships(@CurrentUser() user: AuthUser) {
    return { data: await this.auth.listMemberships(user.sub, user.tid) };
  }

  /**
   * Swaps the session's refresh token for a token pair of another store the
   * user is an active member of. 404 when there is no such membership.
   */
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  async switchTenant(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchTenantDto,
  ) {
    return {
      data: await this.auth.switchTenant(user, dto.tenantId, dto.refreshToken),
    };
  }

  /**
   * BFF only: undoes a switch whose new session could not be stored (INF-18).
   * Not rate limited on purpose: the limiter needs Redis, and this runs when
   * Redis is down. Possession of both refresh tokens is required.
   */
  @Public()
  @Post('switch-tenant/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortSwitchTenant(@Body() dto: AbortSwitchTenantDto) {
    await this.auth.abortSwitchTenant(
      dto.refreshToken,
      dto.previousRefreshToken,
    );
  }
}
