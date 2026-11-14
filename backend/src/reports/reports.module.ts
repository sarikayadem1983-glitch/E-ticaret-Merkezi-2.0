import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Read-only reports over orders (RPT-01). */
@Module({
  imports: [AccessModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
