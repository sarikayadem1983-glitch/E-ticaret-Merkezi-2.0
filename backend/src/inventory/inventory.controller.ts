import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  CreateMovementDto,
  CreateWarehouseDto,
  ListByCompanyQuery,
  ListLevelsQuery,
  ListMovementsQuery,
  CountDto,
  SetThresholdDto,
  TransferDto,
} from './inventory.dto.js';
import { InventoryService, READ, WRITE } from './inventory.service.js';

@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  @RequirePermissions(READ)
  listWarehouses(
    @CurrentUser() user: AuthUser,
    @Query() q: ListByCompanyQuery,
  ) {
    return this.inventory.listWarehouses(user, q);
  }

  @Post('warehouses')
  @RequirePermissions(WRITE)
  createWarehouse(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWarehouseDto,
  ) {
    return this.inventory.createWarehouse(user, dto);
  }

  @Get('stock-levels')
  @RequirePermissions(READ)
  listLevels(@CurrentUser() user: AuthUser, @Query() q: ListLevelsQuery) {
    return this.inventory.listLevels(user, q);
  }

  @Get('stock-movements')
  @RequirePermissions(READ)
  listMovements(@CurrentUser() user: AuthUser, @Query() q: ListMovementsQuery) {
    return this.inventory.listMovements(user, q);
  }

  @Post('stock-movements')
  @RequirePermissions(WRITE)
  createMovement(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMovementDto,
  ) {
    return this.inventory.createMovement(user, dto);
  }

  @Get('stock-levels/low')
  @RequirePermissions(READ)
  lowStock(@CurrentUser() user: AuthUser, @Query() q: ListByCompanyQuery) {
    return this.inventory.lowStock(user, q);
  }

  @Put('stock-thresholds/:variantId')
  @RequirePermissions(WRITE)
  setThreshold(
    @CurrentUser() user: AuthUser,
    @Param(
      'variantId',
      new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND }),
    )
    variantId: string,
    @Body() dto: SetThresholdDto,
  ) {
    return this.inventory.setThreshold(user, variantId, dto);
  }

  @Post('stock-transfers')
  @RequirePermissions(WRITE)
  transfer(@CurrentUser() user: AuthUser, @Body() dto: TransferDto) {
    return this.inventory.transfer(user, dto);
  }

  @Post('stock-counts')
  @RequirePermissions(WRITE)
  count(@CurrentUser() user: AuthUser, @Body() dto: CountDto) {
    return this.inventory.count(user, dto);
  }
}
