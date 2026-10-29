import { Injectable } from '@nestjs/common';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';

export const CATEGORY_FIELDS = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CategorySelect;

export const BRAND_FIELDS = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BrandSelect;

export const VARIANT_FIELDS = {
  id: true,
  productId: true,
  sku: true,
  barcode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductVariantSelect;

const ACTIVE = { deletedAt: null };

export const PRODUCT_FIELDS = {
  id: true,
  companyId: true,
  categoryId: true,
  brandId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  variants: {
    where: ACTIVE,
    select: VARIANT_FIELDS,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ProductSelect;

export type ProductRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_FIELDS;
}>;

export interface ProductFilter {
  /** Allowed companies; undefined = every company in the tenant. */
  companyIds?: string[];
  status?: Prisma.ProductWhereInput['status'];
  categoryId?: string;
  brandId?: string;
  search?: string;
}

interface VariantInput {
  sku: string;
  barcode?: string | null;
}

const paging = (page: number, perPage: number) => ({
  skip: (page - 1) * perPage,
  take: perPage,
});

/**
 * Data access for categories, brands, products and product_variants.
 * Tenant-scoped by the Prisma extension; the company scope comes from the
 * caller (ProductFilter.companyIds) because the extension only covers tenant_id.
 * Soft-deleted rows are never returned, except where a method says so.
 * Prisma sets updated_at (@updatedAt); there are no raw inserts here.
 */
@Injectable()
export class CatalogRepository {
  constructor(@InjectPrisma() readonly prisma: TenantPrismaClient) {}

  // ---- categories ----

  async findCategoryPage(
    search: string | undefined,
    page: number,
    perPage: number,
  ) {
    const where: Prisma.CategoryWhereInput = {
      ...ACTIVE,
      OR: search
        ? [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { startsWith: search.toLowerCase() } },
          ]
        : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        select: CATEGORY_FIELDS,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(page, perPage),
      }),
      this.prisma.category.count({ where }),
    ]);
    return { items, total };
  }

  findCategory(id: string, db: PrismaTx = this.prisma) {
    return db.category.findFirst({
      where: { id, ...ACTIVE },
      select: CATEGORY_FIELDS,
    });
  }

  /** Parent of any category, soft-deleted ones included (tree shape for cycle checks). */
  async findCategoryParent(
    tx: PrismaTx,
    id: string,
  ): Promise<string | null | undefined> {
    const row = await tx.category.findFirst({
      where: { id },
      select: { parentId: true },
    });
    return row ? row.parentId : undefined;
  }

  createCategory(
    tx: PrismaTx,
    data: { name: string; slug: string; parentId: string | null },
  ) {
    return tx.category.create({
      data: { ...data, tenantId: TenantContext.requireTenantId() },
      select: CATEGORY_FIELDS,
    });
  }

  updateCategory(
    tx: PrismaTx,
    id: string,
    data: Prisma.CategoryUncheckedUpdateInput,
  ) {
    return tx.category.update({
      where: { id },
      data,
      select: CATEGORY_FIELDS,
    });
  }

  /** Active child categories plus active products in the category. */
  async countCategoryUsage(tx: PrismaTx, id: string): Promise<number> {
    const [children, products] = await Promise.all([
      tx.category.count({ where: { parentId: id, ...ACTIVE } }),
      tx.product.count({ where: { categoryId: id, ...ACTIVE } }),
    ]);
    return children + products;
  }

  // ---- brands ----

  async findBrandPage(
    search: string | undefined,
    page: number,
    perPage: number,
  ) {
    const where: Prisma.BrandWhereInput = {
      ...ACTIVE,
      name: search ? { contains: search, mode: 'insensitive' } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        select: BRAND_FIELDS,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...paging(page, perPage),
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { items, total };
  }

  findBrand(id: string, db: PrismaTx = this.prisma) {
    return db.brand.findFirst({
      where: { id, ...ACTIVE },
      select: BRAND_FIELDS,
    });
  }

  createBrand(tx: PrismaTx, name: string) {
    return tx.brand.create({
      data: { name, tenantId: TenantContext.requireTenantId() },
      select: BRAND_FIELDS,
    });
  }

  updateBrand(
    tx: PrismaTx,
    id: string,
    data: Prisma.BrandUncheckedUpdateInput,
  ) {
    return tx.brand.update({ where: { id }, data, select: BRAND_FIELDS });
  }

  countBrandUsage(tx: PrismaTx, id: string) {
    return tx.product.count({ where: { brandId: id, ...ACTIVE } });
  }

  // ---- products ----

  private productWhere(filter: ProductFilter): Prisma.ProductWhereInput {
    const s = filter.search;
    return {
      ...ACTIVE,
      companyId: filter.companyIds ? { in: filter.companyIds } : undefined,
      status: filter.status,
      categoryId: filter.categoryId,
      brandId: filter.brandId,
      OR: s
        ? [
            { name: { contains: s, mode: 'insensitive' } },
            {
              variants: {
                some: {
                  ...ACTIVE,
                  OR: [
                    { sku: { startsWith: s } },
                    { barcode: { startsWith: s } },
                  ],
                },
              },
            },
          ]
        : undefined,
    };
  }

  async findProductPage(filter: ProductFilter, page: number, perPage: number) {
    const where = this.productWhere(filter);
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_FIELDS,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...paging(page, perPage),
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  findProduct(id: string, db: PrismaTx = this.prisma) {
    return db.product.findFirst({
      where: { id, ...ACTIVE },
      select: PRODUCT_FIELDS,
    });
  }

  /** Product plus its variants in one transaction. Variants are not nested writes: the extension scopes each create. */
  async createProduct(
    tx: PrismaTx,
    data: Omit<Prisma.ProductUncheckedCreateInput, 'tenantId' | 'variants'>,
    variants: VariantInput[],
  ): Promise<ProductRow> {
    const tenantId = TenantContext.requireTenantId();
    const { id } = await tx.product.create({
      data: { ...data, tenantId },
      select: { id: true },
    });
    await tx.productVariant.createMany({
      data: variants.map((v) => ({
        tenantId,
        companyId: data.companyId,
        productId: id,
        sku: v.sku,
        barcode: v.barcode ?? null,
      })),
    });
    return (await this.findProduct(id, tx)) as ProductRow;
  }

  async updateProduct(
    tx: PrismaTx,
    id: string,
    data: Prisma.ProductUncheckedUpdateInput,
  ): Promise<ProductRow> {
    await tx.product.update({ where: { id }, data, select: { id: true } });
    return (await this.findProduct(id, tx)) as ProductRow;
  }

  // ---- variants ----

  findVariant(productId: string, id: string, db: PrismaTx = this.prisma) {
    return db.productVariant.findFirst({
      where: { id, productId, ...ACTIVE },
      select: VARIANT_FIELDS,
    });
  }

  countVariants(tx: PrismaTx, productId: string) {
    return tx.productVariant.count({ where: { productId, ...ACTIVE } });
  }

  createVariant(
    tx: PrismaTx,
    product: { id: string; companyId: string },
    v: VariantInput,
  ) {
    return tx.productVariant.create({
      data: {
        tenantId: TenantContext.requireTenantId(),
        companyId: product.companyId,
        productId: product.id,
        sku: v.sku,
        barcode: v.barcode ?? null,
      },
      select: VARIANT_FIELDS,
    });
  }

  updateVariant(
    tx: PrismaTx,
    id: string,
    data: Prisma.ProductVariantUncheckedUpdateInput,
  ) {
    return tx.productVariant.update({
      where: { id },
      data,
      select: VARIANT_FIELDS,
    });
  }
}
