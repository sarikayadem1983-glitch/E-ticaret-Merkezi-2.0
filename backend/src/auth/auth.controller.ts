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
import { LoginDto, RefreshTokenDto, RegisterDto } from './auth.dto.js';
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
    return { data: await this.auth.me(user.sub, user.perms) };
  }
}
