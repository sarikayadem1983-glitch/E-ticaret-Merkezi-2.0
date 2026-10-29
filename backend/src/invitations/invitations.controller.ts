import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from '../auth/decorators.js';
import { InvitationsRateLimitService } from './invitations-rate-limit.service.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  InvitationTokenDto,
} from './invitations.dto.js';
import { InvitationsService } from './invitations.service.js';

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly limits: InvitationsRateLimitService,
  ) {}

  @Post()
  @RequirePermissions('users:invite')
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return { data: await this.invitations.create(user, dto) };
  }

  @Get()
  @RequirePermissions('users:read')
  async list() {
    return { data: await this.invitations.listPending() };
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users:invite')
  async resend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.invitations.resend(user, id) };
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users:invite')
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.invitations.revoke(user, id) };
  }

  /** Public: the token travels in the body, never in a URL the API logs. */
  @Public()
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  async lookup(@Body() dto: InvitationTokenDto, @Ip() ip: string) {
    await this.limits.beforeLookup(ip);
    return { data: await this.invitations.lookup(dto.token) };
  }

  @Public()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Body() dto: AcceptInvitationDto, @Ip() ip: string) {
    await this.limits.beforeAccept(ip);
    return { data: await this.invitations.accept(dto, ip) };
  }
}
