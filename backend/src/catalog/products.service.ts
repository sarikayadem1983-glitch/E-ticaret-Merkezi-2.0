import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { CompaniesService } from '../companies/companies.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { AttributesRepository } from './attributes.repository.js';
import type {
  CreateProductDto,
  CreateVariantDto,
  GenerateVariantsDto,
  ListProductsQuery,
  UpdateProductDto,
  UpdateVariantDto,
  VariantAttributeDto,
} from './catalog.dto.js';
import { conflict, notFound, unavailable } from './catalog.errors.js';
import {
  CatalogRepository,
  type ProductRow,
  toVariant,
  type VariantRow,
} from './catalog.repository.js';
import { catalogWrite, MODULE } from './catalog.tx.js';
import {
  type AxisValue,
  cartesian,
  combinationCount,
  combinationKey,
  generatedSku,
  MAX_COMBINATIONS,
} from './variant-matrix.js';

const PRODUCT = 'Product';
const VARIANT = 'ProductVariant';
const missing = () => notFound('Ürün bulunamadı');
const missingVariant = () => notFound('Varyant bulunamadı');

/** Product without its variants: what the audit log stores for the product row. */
const productRow = ({ variants: _variants, ...row }: ProductRow) => row;

/** API shape of a product: variants with flattened attributes. */
export const toProduct = (p: ProductRow) => ({
  ...p,
  variants: p.variants.map(toVariant),
});

const combinationTaken = () =>
  conflict(
    'VARIANT_COMBINATION_TAKEN',
    'Ürünün başka bir varyantı aynı özellik değerlerini taşıyor',
  );

const asAxis = (a: VariantAttributeDto): AxisValue => ({
  attributeId: a.attributeId,
  valueId: a.valueId,
});

const linkKey = (
  links: { attributeId: string; attributeValueId: string }[],
): string =>
  combinationKey(
    links.map((a) => ({
      attributeId: a.attributeId,
      valueId: a.attributeValueId,
    })),
  );

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
    private readonly attributes: AttributesRepository,
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
    return {
      data: items.map(toProduct),
      meta: { page: q.page, per_page: q.per_page, total },
    };
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
    return { data: toProduct(await this.load(user, id, 'products:read')) };
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

  /**
   * Each attribute at most once per set (422 ATTRIBUTE_DUPLICATE); each value
   * active, of an active attribute and of the attribute named with it
   * (422 ATTRIBUTE_UNAVAILABLE). Returns the display text of each value by id.
   */
  private async assertAttributes(
    tx: PrismaTx,
    sets: AxisValue[][],
  ): Promise<Map<string, string>> {
    for (const set of sets) {
      if (new Set(set.map((a) => a.attributeId)).size !== set.length) {
        throw unavailable(
          'ATTRIBUTE_DUPLICATE',
          'Aynı özellik birden fazla kez verilmiş',
        );
      }
    }
    const ids = [...new Set(sets.flat().map((a) => a.valueId))];
    if (ids.length === 0) return new Map();
    const found = await this.attributes.findActiveValues(tx, ids);
    const byId = new Map(found.map((v) => [v.id, v]));
    for (const a of sets.flat()) {
      if (byId.get(a.valueId)?.attributeId !== a.attributeId) {
        throw unavailable(
          'ATTRIBUTE_UNAVAILABLE',
          'Özellik veya değer bulunamadı, silinmiş ya da değer bu özelliğe ait değil',
        );
      }
    }
    return new Map(found.map((v) => [v.id, v.value]));
  }

  /**
   * Attribute sets must be unique among the product's active variants. `sets`
   * are the new/changed variants (excludeId: the variant being changed). Only
   * variants that have attributes take part; plain variants never collide.
   */
  private async assertCombinationsFree(
    tx: PrismaTx,
    productId: string | null,
    sets: { values: AxisValue[]; excludeId?: string }[],
  ) {
    const taken = new Set<string>();
    if (productId) {
      const exclude = new Set(sets.map((s) => s.excludeId).filter(Boolean));
      for (const v of await this.repository.findVariantCombinations(
        tx,
        productId,
      )) {
        if (exclude.has(v.id)) continue;
        const key = linkKey(v.attributeValues);
        if (key) taken.add(key);
      }
    }
    for (const s of sets) {
      const key = combinationKey(s.values);
      if (!key) continue;
      if (taken.has(key)) throw combinationTaken();
      taken.add(key);
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
      const sets = variants.map((v) => (v.attributes ?? []).map(asAxis));
      await this.assertAttributes(tx, sets);
      await this.assertCombinationsFree(
        tx,
        null,
        sets.map((values) => ({ values })),
      );
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
            after: toVariant(v),
          },
          tx,
        );
      }
      return created;
    });
    return { data: toProduct(product) };
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
    return { data: toProduct(product) };
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
            before: toVariant(v),
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
      const values = (dto.attributes ?? []).map(asAxis);
      await this.assertAttributes(tx, [values]);
      await this.assertCombinationsFree(tx, productId, [{ values }]);
      const created = toVariant(
        await this.repository.createVariant(tx, product, dto),
      );
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
      const row = await this.repository.findVariant(productId, id, tx);
      if (!row) throw missingVariant();
      const before = toVariant(row);
      const { attributes, ...fields } = dto;
      if (attributes?.length) {
        const changed = attributes.map(asAxis);
        await this.assertAttributes(tx, [changed]);
        const merged = new Map<string, AxisValue>(
          before.attributes.map((a) => [
            a.attributeId,
            { attributeId: a.attributeId, valueId: a.valueId },
          ]),
        );
        for (const a of changed) merged.set(a.attributeId, a);
        await this.assertCombinationsFree(tx, productId, [
          { values: [...merged.values()], excludeId: id },
        ]);
        await this.repository.setVariantAttributes(tx, id, changed);
      }
      await this.repository.updateVariant(tx, id, fields);
      const after = toVariant(
        (await this.repository.findVariant(productId, id, tx)) as VariantRow,
      );
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
      const row = await this.repository.findVariant(productId, id, tx);
      if (!row) throw missingVariant();
      const before = toVariant(row);
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

  /**
   * Creates one variant per combination of the axis values (cartesian product,
   * axis order kept). Combinations an active variant already has are skipped.
   * One transaction: a SKU conflict creates nothing.
   */
  async generateVariants(
    user: AuthUser,
    productId: string,
    dto: GenerateVariantsDto,
  ) {
    const axisIds = dto.axes.map((a) => a.attributeId);
    if (new Set(axisIds).size !== axisIds.length) {
      throw unavailable(
        'ATTRIBUTE_DUPLICATE',
        'Aynı özellik birden fazla eksen olarak verilmiş',
      );
    }
    const axes: AxisValue[][] = dto.axes.map((a) =>
      a.valueIds.map((valueId) => ({ attributeId: a.attributeId, valueId })),
    );
    if (combinationCount(axes) > MAX_COMBINATIONS) {
      throw unavailable(
        'TOO_MANY_COMBINATIONS',
        `En çok ${MAX_COMBINATIONS} kombinasyon üretilebilir`,
      );
    }
    const result = await catalogWrite(this.repository.prisma, async (tx) => {
      const product = await this.loadForWrite(user, productId, tx);
      // Each value checked on its own: one axis holds many values of one attribute.
      const labels = await this.assertAttributes(
        tx,
        axes.flat().map((v) => [v]),
      );
      const existing = new Set(
        (await this.repository.findVariantCombinations(tx, productId)).map(
          (v) => linkKey(v.attributeValues),
        ),
      );
      const created: ReturnType<typeof toVariant>[] = [];
      let skipped = 0;
      for (const combo of cartesian(axes)) {
        if (existing.has(combinationKey(combo))) {
          skipped++;
          continue;
        }
        const sku = generatedSku(
          dto.skuPrefix,
          combo.map((a) => labels.get(a.valueId) ?? ''),
        );
        const variant = toVariant(
          await this.repository.createVariant(tx, product, {
            sku,
            attributes: combo,
          }),
        );
        await this.audit.record(
          {
            action: 'CREATE',
            module: MODULE,
            entityType: VARIANT,
            entityId: variant.id,
            after: variant,
          },
          tx,
        );
        created.push(variant);
      }
      return { created, skipped };
    });
    return { data: result };
  }
}
