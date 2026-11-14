import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

/** Product import from CSV (IMP-01) and product/stock export (IMP-04). */
@Module({
  imports: [AccessModule, CompaniesModule, CatalogModule, InventoryModule],
  controllers: [ImportsController, ExportsController],
  providers: [ImportsService, ExportsService],
})
export class ImportsModule {}
