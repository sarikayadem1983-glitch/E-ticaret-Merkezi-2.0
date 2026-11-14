import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { ExportsService } from './exports.service.js';

export class ExportQuery {
  @IsOptional()
  @IsUUID()
  company_id?: string;
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('products')
  @RequirePermissions('products:read')
  products(@CurrentUser() user: AuthUser, @Query() q: ExportQuery) {
    return this.exports.products(user, q.company_id);
  }

  @Get('stock')
  @RequirePermissions('inventory:read')
  stock(@CurrentUser() user: AuthUser, @Query() q: ExportQuery) {
    return this.exports.stock(user, q.company_id);
  }
}
