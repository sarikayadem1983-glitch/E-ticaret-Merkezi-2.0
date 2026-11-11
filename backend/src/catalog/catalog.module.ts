import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { AttributesRepository } from './attributes.repository.js';
import { AttributesService } from './attributes.service.js';
import { BrandsService } from './brands.service.js';
import {
  AttributesController,
  BrandsController,
  CategoriesController,
  ProductsController,
} from './catalog.controller.js';
import { CatalogRepository } from './catalog.repository.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

/** Categories, brands, products and variants (CAT-02), variant attributes (CAT-03). Companies are read through CompaniesService. */
@Module({
  imports: [AccessModule, CompaniesModule],
  controllers: [
    CategoriesController,
    BrandsController,
    AttributesController,
    ProductsController,
  ],
  providers: [
    CatalogRepository,
    AttributesRepository,
    AttributesService,
    CategoriesService,
    BrandsService,
    ProductsService,
  ],
  exports: [ProductsService],
})
export class CatalogModule {}
