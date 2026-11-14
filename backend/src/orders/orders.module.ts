import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Orders (ORD-02). Variants are read through ProductsService, companies through CompaniesService. */
@Module({
  imports: [AccessModule, CompaniesModule, CatalogModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
