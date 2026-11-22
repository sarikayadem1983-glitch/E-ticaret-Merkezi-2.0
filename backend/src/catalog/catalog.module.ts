import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { StorageModule } from '../storage/storage.module.js';
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
import { ChannelMappingController } from './channel-mapping.controller.js';
import { ChannelMappingService } from './channel-mapping.service.js';
import { ImagesController } from './images.controller.js';
import { ImagesService } from './images.service.js';
import { ProductsService } from './products.service.js';

/** Categories, brands, products and variants (CAT-02), variant attributes (CAT-03). Companies are read through CompaniesService. */
@Module({
  imports: [AccessModule, CompaniesModule, RateLimitModule, StorageModule],
  controllers: [
    CategoriesController,
    BrandsController,
    AttributesController,
    ProductsController,
    ImagesController,
    ChannelMappingController,
  ],
  providers: [
    CatalogRepository,
    AttributesRepository,
    AttributesService,
    CategoriesService,
    BrandsService,
    ProductsService,
    ImagesService,
    ChannelMappingService,
  ],
  exports: [ProductsService],
})
export class CatalogModule {}
