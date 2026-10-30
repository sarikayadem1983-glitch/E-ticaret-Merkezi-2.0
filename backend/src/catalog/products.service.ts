import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type {
  CreateProductDto,
  CreateVariantDto,
  ListProductsQuery,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalog.dto.js';
import { conflict, notFound, unavailable } from './catalog.errors.js';
import { CatalogRepository, type ProductRow } from './catalog.repository.js';
import { catalogWrite, MODULE } from './catalog.tx.js';

const PRODUCT = 'Product';
const VARIANT = 'ProductVariant';
const missing = () => notFound('Ürün bulunamadı');
const missingVariant = () => notFound('Varyant bulunamadı');

/** Product without its variants: what the audit log stores for the product row. */
const productRow = ({ variants: _variants, ...row }: ProductRow) => row;

/**
 * Products and variants of one company. Every access is checked against the
 * member's role in the product's company, read from the database: no role →
 * 404, a role without the permission → 403.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly companies: CompaniesService,
  ) {}

  async list(user: AuthUser, q: ListProductsQuery) {
    const scope = await this.access.companyScope(user, 'products:read');
    let companyIds: string[] | undefined;
    if (scope === null) {
      companyIds = q.company_id ? [q.company_id] : undefined;
    } else {
      companyIds = q.company_id
        ? scope.filter((id) => id === q.company_id)
        : scope;
    }
    const { items, total } = await this.repository.findProductPage(
      {
        companyIds,
        status: q.status,
        categoryId: q.category_id,
        brandId: q.brand_id,
        search: q.search || undefined,
      },
      q.page,
      q.per_page,
    );
    return { data: items, meta: { page: q.page, per_page: q.per_page, total } };
  }

  /** The member's role in the company; a missing company role reads as a missing product. */
  private async assertProductPermission(
    user: AuthUser,
    companyId: string,
    permission: string,
  ) {
    try {
      await this.access.assertCompanyPermission(user, companyId, permission);
    } catch (error) {
      if (error instanceof NotFoundException) throw missing();
      throw error;
    }
  }

  /** Loads an active product the member may access with `permission`. */
  private async load(
    user: AuthUser,
    id: string,
    permission: string,
    db?: PrismaTx,
  ): Promise<ProductRow> {
    const product = await this.repository.findProduct(id, db);
    if (!product) throw missing();
    await this.assertProductPermission(user, product.companyId, permission);
    return product;
  }

  /** Loads a product for a write: its company must also be active (409 COMPANY_INACTIVE). */
  private async loadForWrite(
    user: AuthUser,
    id: string,
    tx: PrismaTx,
  ): Promise<ProductRow> {
    const product = await this.load(user, id, 'products:write', tx);
    await this.assertCompanyActive(product.companyId, tx);
    return product;
  }

  /** The catalog of an inactive company is frozen: readable, not writable. */
  private async assertCompanyActive(companyId: string, tx: PrismaTx) {
    const [active] = await this.companies.activeByIds([companyId], tx);
    if (!active) {
      throw conflict(
        'COMPANY_INACTIVE',
        'Firma pasif; ürünleri değiştirilemez',
      );
    }
  }

  async get(user: AuthUser, id: string) {
    return { data: await this.load(user, id, 'products:read') };
  }

  /** Category and brand must exist in the tenant and not be soft-deleted. */
  private async assertLinks(
    tx: PrismaTx,
    links: { categoryId?: string | null; brandId?: string | null },
  ) {
    if (
      links.categoryId &&
      !(await this.repository.findCategory(links.categoryId, tx))
    ) {
      throw unavailable(
        'CATEGORY_UNAVAILABLE',
        'Kategori bulunamadı veya silinmiş',
      );
    }
    if (
      links.brandId &&
      !(await this.repository.findBrand(links.brandId, tx))
    ) {
      throw unavailable('BRAND_UNAVAILABLE', 'Marka bulunamadı veya silinmiş');
    }
  }

  async create(user: AuthUser, dto: CreateProductDto) {
    // Role in the target company first (404/403), then that it exists here.
    await this.access.assertCompanyPermission(
      user,
      dto.companyId,
      'products:write',
    );
    await this.companies.get(user, dto.companyId);
    const { variants, ...fields } = dto;
    const product = await catalogWrite(this.repository.prisma, async (tx) => {
      await this.assertCompanyActive(dto.companyId, tx);
      await this.assertLinks(tx, fields);
      const created = await this.repository.createProduct(tx, fields, variants);
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: PRODUCT,
          entityId: created.id,
          after: productRow(created),
        },
        tx,
      );
      for (const v of created.variants) {
        await this.audit.record(
          {
            action: 'CREATE',
            module: MODULE,
            entityType: VARIANT,
            entityId: v.id,
            after: v,
          },
          tx,
        );
      }
      return created;
    });
    return { data: product };
  }

  async update(user: AuthUser, id: string, dto: UpdateProductDto) {
    const product = await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.loadForWrite(user, id, tx);
      await this.assertLinks(tx, dto);
      const after = await this.repository.updateProduct(tx, id, dto);
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: PRODUCT,
          entityId: id,
          before: productRow(before),
          after: productRow(after),
        },
        tx,
      );
      return after;
    });
    return { data: product };
  }

  /** Soft-deletes the product and its active variants. SKUs/barcodes stay reserved. */
  async remove(user: AuthUser, id: string): Promise<void> {
    await catalogWrite(this.repository.prisma, async (tx) => {
      const before = await this.loadForWrite(user, id, tx);
      const deletedAt = new Date();
      for (const v of before.variants) {
        await this.repository.updateVariant(tx, v.id, { deletedAt });
        await this.audit.record(
          {
            action: 'DELETE',
            module: MODULE,
            entityType: VARIANT,
            entityId: v.id,
            before: v,
          },
          tx,
        );
      }
      await this.repository.updateProduct(tx, id, { deletedAt });
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: PRODUCT,
          entityId: id,
          before: productRow(before),
        },
        tx,
      );
    });
  }

  // ---- variants ----

  async addVariant(user: AuthUser, productId: string, dto: CreateVariantDto) {
    const variant = await catalogWrite(this.repository.prisma, async (tx) => {
      const product = await this.loadForWrite(user, productId, tx);
      const created = await this.repository.createVariant(tx, product, dto);
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: VARIANT,
          entityId: created.id,
          after: created,
        },
        tx,
      );
      return created;
    });
    return { data: variant };
  }

  async updateVariant(
    user: AuthUser,
    productId: string,
    id: string,
    dto: UpdateVariantDto,
  ) {
    const variant = await catalogWrite(this.repository.prisma, async (tx) => {
      await this.loadForWrite(user, productId, tx);
      const before = await this.repository.findVariant(productId, id, tx);
      if (!before) throw missingVariant();
      const after = await this.repository.updateVariant(tx, id, dto);
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: VARIANT,
          entityId: id,
          before,
          after,
        },
        tx,
      );
      return after;
    });
    return { data: variant };
  }

  /** Soft delete. The last active variant cannot go: delete the product instead. */
  async removeVariant(
    user: AuthUser,
    productId: string,
    id: string,
  ): Promise<void> {
    await catalogWrite(this.repository.prisma, async (tx) => {
      await this.loadForWrite(user, productId, tx);
      const before = await this.repository.findVariant(productId, id, tx);
      if (!before) throw missingVariant();
      if ((await this.repository.countVariants(tx, productId)) <= 1) {
        throw conflict(
          'LAST_VARIANT',
          'Ürünün son varyantı silinemez; ürünü silin veya arşivleyin',
        );
      }
      await this.repository.updateVariant(tx, id, { deletedAt: new Date() });
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: VARIANT,
          entityId: id,
          before,
        },
        tx,
      );
    });
  }
}
