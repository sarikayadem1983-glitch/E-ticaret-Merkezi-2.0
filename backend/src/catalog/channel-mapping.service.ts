import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { channelDefinition } from '../channels/channel-adapter.js';
import type { PrismaTx } from '../database/prisma.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { notFound, unavailable } from './catalog.errors.js';
import { CatalogRepository } from './catalog.repository.js';
import {
  assertTenantCatalogWriter,
  catalogWrite,
  MODULE,
} from './catalog.tx.js';
import type {
  ImportChannelTreeDto,
  ListChannelCategoriesQuery,
  MapAttributeDto,
  MapCategoryDto,
  SetProductChannelValuesDto,
} from './channel-mapping.dto.js';
import { ProductsService } from './products.service.js';

const LIVE = { deletedAt: null };

interface AllowedValue {
  externalId: string;
  name: string;
}

export type MissingCode =
  | 'CATEGORY_MISSING'
  | 'CATEGORY_NOT_MAPPED'
  | 'CHANNEL_CATEGORY_INVALID'
  | 'ATTRIBUTE_NOT_MAPPED'
  | 'VARIANT_VALUE_MISSING'
  | 'VALUE_MISSING';

export interface MissingItem {
  code: MissingCode;
  message: string;
  channelAttributeId?: string;
  attributeName?: string;
  variants?: string[];
}

const invalid = (message: string, details?: unknown) =>
  new UnprocessableEntityException({
    code: 'VALIDATION_ERROR',
    message,
    ...(details ? { details } : {}),
  });

/**
 * CAT-06: marketplace category trees, mapping of our categories and variant
 * attributes to them, product-level channel attribute values, and a readiness
 * check that lists what is missing before a product can be listed.
 *
 * Trees and mappings are tenant-wide (Owner/Admin, like categories); product
 * values follow the product's company permissions.
 */
@Injectable()
export class ChannelMappingService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly products: ProductsService,
  ) {}

  private get prisma() {
    return this.repository.prisma;
  }

  private channel(code: string): string {
    if (!channelDefinition(code)) throw notFound('Kanal bulunamadı');
    return code;
  }

  /** Validates parents, uniqueness and cycles inside one import payload. */
  private checkTree(dto: ImportChannelTreeDto) {
    const ids = new Map<string, (typeof dto.categories)[number]>();
    for (const c of dto.categories) {
      if (ids.has(c.externalId)) {
        throw invalid(`Kategori kimliği iki kez geçiyor: ${c.externalId}`);
      }
      ids.set(c.externalId, c);
    }
    const hasChildren = new Set<string>();
    for (const c of dto.categories) {
      const parent = c.parentExternalId ?? null;
      if (parent === null) continue;
      if (!ids.has(parent)) {
        throw invalid(`Üst kategori bulunamadı: ${parent} (${c.externalId})`);
      }
      hasChildren.add(parent);
    }
    for (const c of dto.categories) {
      if (c.isLeaf && hasChildren.has(c.externalId)) {
        throw invalid(
          `Yaprak kategorinin alt kategorisi olamaz: ${c.externalId}`,
        );
      }
      const seen = new Set<string>();
      let cur: string | null = c.externalId;
      while (cur !== null) {
        if (seen.has(cur))
          throw invalid(`Kategori ağacında döngü var: ${c.externalId}`);
        seen.add(cur);
        cur = ids.get(cur)?.parentExternalId ?? null;
      }
      const attrIds = new Set<string>();
      for (const a of c.attributes ?? []) {
        if (attrIds.has(a.externalId)) {
          throw invalid(
            `Özellik iki kez geçiyor: ${c.externalId}/${a.externalId}`,
          );
        }
        attrIds.add(a.externalId);
        if (!a.allowCustom && a.values.length === 0) {
          throw invalid(
            `Değer listesi boş ve serbest değer kapalı: ${c.externalId}/${a.externalId}`,
          );
        }
      }
    }
  }

  async importTree(
    user: AuthUser,
    channelCode: string,
    dto: ImportChannelTreeDto,
  ) {
    const channel = this.channel(channelCode);
    await assertTenantCatalogWriter(this.access, user);
    this.checkTree(dto);
    const tenantId = TenantContext.requireTenantId();
    const result = await catalogWrite(this.prisma, async (tx) => {
      const now = new Date();
      let categories = 0;
      let attributes = 0;
      const keep = dto.categories.map((c) => c.externalId);
      for (const c of dto.categories) {
        const row = await tx.channelCategory.upsert({
          where: {
            tenantId_channel_externalId: {
              tenantId,
              channel,
              externalId: c.externalId,
            },
          },
          create: {
            tenantId,
            channel,
            externalId: c.externalId,
            parentExternalId: c.parentExternalId ?? null,
            name: c.name,
            isLeaf: c.isLeaf,
          },
          update: {
            parentExternalId: c.parentExternalId ?? null,
            name: c.name,
            isLeaf: c.isLeaf,
            deletedAt: null,
          },
          select: { id: true },
        });
        categories++;
        const attrs = c.attributes ?? [];
        for (const a of attrs) {
          const data = {
            name: a.name,
            required: a.required,
            variesByVariant: a.variesByVariant,
            allowCustom: a.allowCustom,
            allowedValues: a.values.map((v) => ({
              externalId: v.externalId,
              name: v.name,
            })) as Prisma.InputJsonValue,
          };
          await tx.channelCategoryAttribute.upsert({
            where: {
              tenantId_channelCategoryId_externalId: {
                tenantId,
                channelCategoryId: row.id,
                externalId: a.externalId,
              },
            },
            create: {
              tenantId,
              channelCategoryId: row.id,
              externalId: a.externalId,
              ...data,
            },
            update: { ...data, deletedAt: null },
          });
          attributes++;
        }
        await tx.channelCategoryAttribute.updateMany({
          where: {
            channelCategoryId: row.id,
            externalId: { notIn: attrs.map((a) => a.externalId) },
            ...LIVE,
          },
          data: { deletedAt: now },
        });
      }
      const removed = await tx.channelCategory.updateMany({
        where: { channel, externalId: { notIn: keep }, ...LIVE },
        data: { deletedAt: now },
      });
      await tx.channelCategoryAttribute.updateMany({
        where: { category: { channel, deletedAt: { not: null } }, ...LIVE },
        data: { deletedAt: now },
      });
      const summary = {
        channel,
        categories,
        attributes,
        removedCategories: removed.count,
      };
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: 'ChannelCategoryTree',
          after: summary,
        },
        tx,
      );
      return summary;
    });
    return { data: result };
  }

  async listCategories(channelCode: string, q: ListChannelCategoriesQuery) {
    const channel = this.channel(channelCode);
    const rows = await this.prisma.channelCategory.findMany({
      where: {
        channel,
        ...LIVE,
        ...(q.search
          ? { name: { contains: q.search, mode: 'insensitive' } }
          : { parentExternalId: q.parent ?? null }),
      },
      select: {
        externalId: true,
        parentExternalId: true,
        name: true,
        isLeaf: true,
      },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return { data: rows };
  }

  private async liveCategory(
    channel: string,
    externalId: string,
    db: PrismaTx,
  ) {
    const row = await db.channelCategory.findFirst({
      where: { channel, externalId, ...LIVE },
      select: { id: true, externalId: true, name: true, isLeaf: true },
    });
    if (!row) throw notFound('Kanal kategorisi bulunamadı');
    return row;
  }

  async categoryAttributes(channelCode: string, externalId: string) {
    const channel = this.channel(channelCode);
    const category = await this.liveCategory(channel, externalId, this.prisma);
    const rows = await this.prisma.channelCategoryAttribute.findMany({
      where: { channelCategoryId: category.id, ...LIVE },
      select: {
        id: true,
        externalId: true,
        name: true,
        required: true,
        variesByVariant: true,
        allowCustom: true,
        allowedValues: true,
        attributeMappings: { select: { attributeId: true } },
      },
      orderBy: [{ required: 'desc' }, { name: 'asc' }],
    });
    return {
      data: {
        category: {
          externalId: category.externalId,
          name: category.name,
          isLeaf: category.isLeaf,
        },
        attributes: rows.map(({ attributeMappings, ...a }) => ({
          ...a,
          mappedAttributeId: attributeMappings[0]?.attributeId ?? null,
        })),
      },
    };
  }

  async mapCategory(
    user: AuthUser,
    categoryId: string,
    channelCode: string,
    dto: MapCategoryDto,
  ) {
    const channel = this.channel(channelCode);
    await assertTenantCatalogWriter(this.access, user);
    const row = await catalogWrite(this.prisma, async (tx) => {
      const category = await tx.category.findFirst({
        where: { id: categoryId, ...LIVE },
        select: { id: true },
      });
      if (!category) throw notFound('Kategori bulunamadı');
      const target = await this.liveCategory(
        channel,
        dto.channelCategoryExternalId,
        tx,
      );
      if (!target.isLeaf) {
        throw unavailable(
          'CHANNEL_CATEGORY_NOT_LEAF',
          'Yalnızca en alt (yaprak) kanal kategorisi seçilebilir',
        );
      }
      const tenantId = TenantContext.requireTenantId();
      await tx.categoryChannelMapping.upsert({
        where: {
          tenantId_categoryId_channel: { tenantId, categoryId, channel },
        },
        create: { tenantId, categoryId, channel, channelCategoryId: target.id },
        update: { channelCategoryId: target.id },
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: 'CategoryChannelMapping',
          entityId: categoryId,
          after: { channel, channelCategory: target.externalId },
        },
        tx,
      );
      return {
        categoryId,
        channel,
        channelCategory: { externalId: target.externalId, name: target.name },
      };
    });
    return { data: row };
  }

  async unmapCategory(user: AuthUser, categoryId: string, channelCode: string) {
    const channel = this.channel(channelCode);
    await assertTenantCatalogWriter(this.access, user);
    await catalogWrite(this.prisma, async (tx) => {
      const { count } = await tx.categoryChannelMapping.deleteMany({
        where: { categoryId, channel },
      });
      if (count === 0) throw notFound('Eşleme bulunamadı');
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: 'CategoryChannelMapping',
          entityId: categoryId,
          before: { channel },
        },
        tx,
      );
    });
  }

  async mapAttribute(
    user: AuthUser,
    channelAttributeId: string,
    dto: MapAttributeDto,
  ) {
    await assertTenantCatalogWriter(this.access, user);
    const row = await catalogWrite(this.prisma, async (tx) => {
      const target = await tx.channelCategoryAttribute.findFirst({
        where: { id: channelAttributeId, ...LIVE, category: LIVE },
        select: { id: true, variesByVariant: true },
      });
      if (!target) throw notFound('Kanal özelliği bulunamadı');
      if (!target.variesByVariant) {
        throw unavailable(
          'CHANNEL_ATTRIBUTE_PRODUCT_LEVEL',
          'Bu kanal özelliği ürün düzeyinde; değeri ürün için girilir, varyant özelliğiyle eşlenmez',
        );
      }
      const attribute = await tx.attribute.findFirst({
        where: { id: dto.attributeId, ...LIVE },
        select: { id: true },
      });
      if (!attribute) throw notFound('Özellik bulunamadı');
      const tenantId = TenantContext.requireTenantId();
      await tx.attributeChannelMapping.upsert({
        where: {
          tenantId_channelCategoryAttributeId: {
            tenantId,
            channelCategoryAttributeId: target.id,
          },
        },
        create: {
          tenantId,
          channelCategoryAttributeId: target.id,
          attributeId: attribute.id,
        },
        update: { attributeId: attribute.id },
      });
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: 'AttributeChannelMapping',
          entityId: target.id,
          after: { attributeId: attribute.id },
        },
        tx,
      );
      return { channelAttributeId: target.id, attributeId: attribute.id };
    });
    return { data: row };
  }

  /** The live leaf channel category mapped for the product's category, or null. */
  private async productTarget(
    categoryId: string | null,
    channel: string,
    db: PrismaTx,
  ) {
    if (!categoryId) return null;
    const mapping = await db.categoryChannelMapping.findFirst({
      where: { categoryId, channel },
      select: {
        channelCategory: {
          select: {
            id: true,
            externalId: true,
            name: true,
            isLeaf: true,
            deletedAt: true,
          },
        },
      },
    });
    return mapping?.channelCategory ?? null;
  }

  async setProductValues(
    user: AuthUser,
    productId: string,
    channelCode: string,
    dto: SetProductChannelValuesDto,
  ) {
    const channel = this.channel(channelCode);
    const saved = await catalogWrite(this.prisma, async (tx) => {
      const product = await this.products.accessible(user, productId, true, tx);
      const target = await this.productTarget(product.categoryId, channel, tx);
      if (!target || target.deletedAt || !target.isLeaf) {
        throw unavailable(
          'CATEGORY_NOT_MAPPED',
          'Ürünün kategorisi bu kanalda geçerli bir kategoriye eşlenmemiş',
        );
      }
      const attrs = await tx.channelCategoryAttribute.findMany({
        where: { channelCategoryId: target.id, ...LIVE },
        select: {
          id: true,
          name: true,
          variesByVariant: true,
          allowCustom: true,
          allowedValues: true,
        },
      });
      const byId = new Map(attrs.map((a) => [a.id, a]));
      const seen = new Set<string>();
      const errors: { field: string; message: string }[] = [];
      const rows: {
        channelCategoryAttributeId: string;
        valueExternalId: string | null;
        value: string;
      }[] = [];
      dto.values.forEach((v, i) => {
        const field = `values.${i}`;
        const a = byId.get(v.channelAttributeId);
        if (!a)
          return errors.push({
            field,
            message: 'Bu kanal kategorisinde böyle bir özellik yok',
          });
        if (seen.has(a.id))
          return errors.push({ field, message: 'Özellik iki kez gönderildi' });
        seen.add(a.id);
        if (a.variesByVariant) {
          return errors.push({
            field,
            message: `${a.name} varyanta göre değişir; varyant özelliğiyle eşlenir`,
          });
        }
        if (v.valueExternalId) {
          const allowed = (a.allowedValues as unknown as AllowedValue[]).find(
            (x) => x.externalId === v.valueExternalId,
          );
          if (!allowed)
            return errors.push({
              field,
              message: `${a.name} için geçersiz değer`,
            });
          rows.push({
            channelCategoryAttributeId: a.id,
            valueExternalId: allowed.externalId,
            value: allowed.name,
          });
        } else if (v.value && a.allowCustom) {
          rows.push({
            channelCategoryAttributeId: a.id,
            valueExternalId: null,
            value: v.value,
          });
        } else {
          errors.push({
            field,
            message: a.allowCustom
              ? `${a.name} için değer girin`
              : `${a.name} için listeden bir değer seçin`,
          });
        }
      });
      if (errors.length)
        throw invalid('Kanal özellik değerleri geçersiz', errors);
      await tx.productChannelAttributeValue.deleteMany({
        where: {
          productId,
          channelCategoryAttributeId: { in: attrs.map((a) => a.id) },
        },
      });
      const tenantId = TenantContext.requireTenantId();
      if (rows.length) {
        await tx.productChannelAttributeValue.createMany({
          data: rows.map((r) => ({ tenantId, productId, ...r })),
        });
      }
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: 'ProductChannelValues',
          entityId: productId,
          after: {
            channel,
            values: rows.map((r) => ({
              attribute: r.channelCategoryAttributeId,
              value: r.value,
            })),
          },
        },
        tx,
      );
      return rows;
    });
    return { data: { productId, channel, values: saved } };
  }

  /** What blocks listing the product on the channel. Empty `missing` = ready. */
  async readiness(user: AuthUser, productId: string, channelCode: string) {
    const channel = this.channel(channelCode);
    const db = this.prisma as unknown as PrismaTx;
    const product = await this.products.accessible(user, productId, false, db);
    const missing: MissingItem[] = [];
    const done = (category: { externalId: string; name: string } | null) => ({
      data: {
        productId,
        channel,
        ready: missing.length === 0,
        channelCategory: category,
        missing,
      },
    });
    if (!product.categoryId) {
      missing.push({
        code: 'CATEGORY_MISSING',
        message: 'Ürünün kategorisi seçilmemiş',
      });
      return done(null);
    }
    const target = await this.productTarget(product.categoryId, channel, db);
    if (!target) {
      missing.push({
        code: 'CATEGORY_NOT_MAPPED',
        message: 'Ürünün kategorisi bu kanalda bir kategoriye eşlenmemiş',
      });
      return done(null);
    }
    const category = { externalId: target.externalId, name: target.name };
    if (target.deletedAt || !target.isLeaf) {
      missing.push({
        code: 'CHANNEL_CATEGORY_INVALID',
        message:
          'Eşlenen kanal kategorisi artık geçerli değil; yeniden eşleyin',
      });
      return done(category);
    }
    const [attrs, values, variants] = await Promise.all([
      db.channelCategoryAttribute.findMany({
        where: { channelCategoryId: target.id, required: true, ...LIVE },
        select: {
          id: true,
          name: true,
          variesByVariant: true,
          attributeMappings: { select: { attributeId: true } },
        },
        orderBy: { name: 'asc' },
      }),
      db.productChannelAttributeValue.findMany({
        where: { productId },
        select: { channelCategoryAttributeId: true },
      }),
      db.productVariant.findMany({
        where: { productId, ...LIVE },
        select: {
          sku: true,
          attributeValues: { select: { attributeId: true } },
        },
        orderBy: { sku: 'asc' },
      }),
    ]);
    const filled = new Set(values.map((v) => v.channelCategoryAttributeId));
    for (const a of attrs) {
      if (!a.variesByVariant) {
        if (!filled.has(a.id)) {
          missing.push({
            code: 'VALUE_MISSING',
            channelAttributeId: a.id,
            attributeName: a.name,
            message: `${a.name} değeri girilmemiş`,
          });
        }
        continue;
      }
      const mapped = a.attributeMappings[0]?.attributeId;
      if (!mapped) {
        missing.push({
          code: 'ATTRIBUTE_NOT_MAPPED',
          channelAttributeId: a.id,
          attributeName: a.name,
          message: `${a.name} bir varyant özelliğiyle eşlenmemiş`,
        });
        continue;
      }
      const lacking = variants
        .filter((v) => !v.attributeValues.some((x) => x.attributeId === mapped))
        .map((v) => v.sku);
      if (lacking.length) {
        missing.push({
          code: 'VARIANT_VALUE_MISSING',
          channelAttributeId: a.id,
          attributeName: a.name,
          variants: lacking,
          message: `${a.name} değeri olmayan varyantlar var`,
        });
      }
    }
    return done(category);
  }
}
