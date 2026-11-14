import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { type AuthUser, CurrentUser } from '../auth/decorators.js';
import { DashboardService } from './dashboard.service.js';

export class KpiQuery {
  @IsOptional()
  @IsUUID()
  company_id?: string;
}

/** No single permission: each KPI checks its own and is null when not allowed. */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('kpis')
  kpis(@CurrentUser() user: AuthUser, @Query() q: KpiQuery) {
    return this.dashboard.kpis(user, q.company_id);
  }
}
