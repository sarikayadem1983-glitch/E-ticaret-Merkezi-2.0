import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { UpdateAccessDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  async list() {
    return { data: await this.users.list() };
  }

  @Put(':userId/access')
  @RequirePermissions('users:manage')
  async updateAccess(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return { data: await this.users.updateAccess(user, userId, dto) };
  }

  @Post(':userId/deactivate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users:manage')
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return { data: await this.users.setStatus(user, userId, 'inactive') };
  }

  @Post(':userId/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('users:manage')
  async activate(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return { data: await this.users.setStatus(user, userId, 'active') };
  }
}
