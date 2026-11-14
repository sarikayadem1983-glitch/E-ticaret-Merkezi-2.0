import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { SyncModule } from '../sync/sync.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

/** Dashboard KPIs (DSH-02), built from the modules that own the data. */
@Module({
  imports: [AccessModule, ReportsModule, InventoryModule, SyncModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
