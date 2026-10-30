import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import { BrandsService } from './brands.service.js';
import {
  BrandDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  ListCatalogQuery,
  ListProductsQuery,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalog.dto.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

const uuid = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.NOT_FOUND,
});

// Categories and brands are tenant-wide: writes need a tenant role that writes
// products in every company (the guard checks the JWT, the service re-checks
// the database).
const TENANT_WRITE = ['products:write', 'companies:all'];

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('products:read')
  list(@Query() q: ListCatalogQuery) {
    return this.categories.list(q);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  get(@Param('id', uuid) id: string) {
    return this.categories.get(id);
  }

  @Post()
  @RequirePermissions(...TENANT_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(...TENANT_WRITE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(...TENANT_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.categories.remove(user, id);
  }
}

@Controller('brands')
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermissions('products:read')
  list(@Query() q: ListCatalogQuery) {
    return this.brands.list(q);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  get(@Param('id', uuid) id: string) {
    return this.brands.get(id);
  }

  @Post()
  @RequirePermissions(...TENANT_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: BrandDto) {
    return this.brands.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions(...TENANT_WRITE)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: BrandDto,
  ) {
    return this.brands.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(...TENANT_WRITE)
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.brands.remove(user, id);
  }
}

// Products belong to one company. The guard checks the module permission from
// the JWT; the service decides from the member's role in the product's company
// (no role → 404, read-only role → 403).
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products:read')
  list(@CurrentUser() user: AuthUser, @Query() q: ListProductsQuery) {
    return this.products.list(user, q);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.products.get(user, id);
  }

  @Post()
  @RequirePermissions('products:write')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.products.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('products:write')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products:write')
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.products.remove(user, id);
  }

  @Post(':id/variants')
  @RequirePermissions('products:write')
  addVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.products.addVariant(user, id, dto);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions('products:write')
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('variantId', uuid) variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(user, id, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('products:write')
  removeVariant(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('variantId', uuid) variantId: string,
  ) {
    return this.products.removeVariant(user, id, variantId);
  }
}
