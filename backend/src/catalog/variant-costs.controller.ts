import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { SetPriceDto } from './catalog.dto.js';
import { VariantCostsService } from './variant-costs.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

@Controller('products/:id/variants/:variantId/cost')
export class VariantCostsController {
  constructor(private readonly costs: VariantCostsService) {}

  @Get()
  @RequirePermissions('products:write')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('variantId', uuid) variantId: string,
  ) {
    return this.costs.get(user, id, variantId);
  }

  @Put()
  @RequirePermissions('products:write')
  set(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('variantId', uuid) variantId: string,
    @Body() dto: SetPriceDto,
  ) {
    return this.costs.set(user, id, variantId, dto);
  }
}
