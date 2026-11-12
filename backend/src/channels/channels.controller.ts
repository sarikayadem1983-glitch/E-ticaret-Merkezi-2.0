import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  CreateChannelAccountDto,
  UpdateChannelAccountDto,
} from './channels.dto.js';
import { ChannelsService, MANAGE } from './channels.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** Marketplace accounts of a company. Credentials are write-only; responses are masked. */
@Controller('companies/:companyId/channel-accounts')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @RequirePermissions(MANAGE)
  list(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
  ) {
    return this.channels.list(user, companyId);
  }

  @Get(':id')
  @RequirePermissions(MANAGE)
  get(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('id', uuid) id: string,
  ) {
    return this.channels.get(user, companyId, id);
  }

  @Post()
  @RequirePermissions(MANAGE)
  create(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Body() dto: CreateChannelAccountDto,
  ) {
    return this.channels.create(user, companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateChannelAccountDto,
  ) {
    return this.channels.update(user, companyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('id', uuid) id: string,
  ) {
    return this.channels.remove(user, companyId, id);
  }
}
