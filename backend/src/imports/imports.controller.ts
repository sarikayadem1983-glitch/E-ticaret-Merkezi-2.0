import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { ImportProductsDto, ImportsService } from './imports.service.js';
import { template } from './product-csv.js';

@Controller('imports/products')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('template')
  @RequirePermissions('products:write')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="urun-sablonu.csv"')
  template() {
    return template();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('products:write')
  importProducts(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportProductsDto,
  ) {
    return this.imports.importProducts(user, dto);
  }
}
