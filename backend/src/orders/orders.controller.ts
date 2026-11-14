import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  ChangeStatusDto,
  CreateOrderDto,
  ListOrdersQuery,
} from './orders.dto.js';
import { OrdersService, READ, WRITE } from './orders.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(READ)
  list(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQuery) {
    return this.orders.list(user, q);
  }

  @Get(':id')
  @RequirePermissions(READ)
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.orders.get(user, id);
  }

  @Post()
  @RequirePermissions(WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(WRITE)
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.orders.changeStatus(user, id, dto);
  }
}
