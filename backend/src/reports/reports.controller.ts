import { Controller, Get, Query } from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { READ, ReportsService, SalesReportQuery } from './reports.service.js';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @RequirePermissions(READ)
  sales(@CurrentUser() user: AuthUser, @Query() q: SalesReportQuery) {
    return this.reports.sales(user, q);
  }
}
