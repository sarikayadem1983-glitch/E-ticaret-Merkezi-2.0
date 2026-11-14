import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

/** Product import from CSV (IMP-01). Products are written through ProductsService. */
@Module({
  imports: [AccessModule, CompaniesModule, CatalogModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
