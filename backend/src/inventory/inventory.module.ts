import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { InventoryController } from './inventory.controller.js';
import { ReservationsRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

/** Warehouses, stock levels, movements (INV-01/02) and order reservations. */
@Module({
  imports: [AccessModule, CompaniesModule, CatalogModule],
  controllers: [InventoryController],
  providers: [InventoryService, ReservationsRepository],
  exports: [InventoryService, ReservationsRepository],
})
export class InventoryModule {}
