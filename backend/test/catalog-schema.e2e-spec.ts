import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';
import type { TenantPrismaClient } from '../src/database/prisma.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { TenantContext } from '../src/tenancy/tenant-context.js';
import { tenantExtension } from '../src/tenancy/tenant-prisma.extension.js';
import { appPool, purgeTenants } from './helpers.js';

/**
 * CAT-01 catalog schema: tenant isolation through the tenant-scoped Prisma
 * client, and database-level guarantees (composite FKs, per-tenant uniqueness)
 * checked as the application role, bypassing every application guard.
 */
describe('Catalog schema (e2e)', () => {
  const run = randomUUID().slice(0, 8);
  const slugs = [`cat-a-${run}`, `cat-b-${run}`];
  let base: PrismaClient;
  let prisma: TenantPrismaClient;
  let db: pg.Pool;

  let tenantA: string;
  let tenantB: string;
  let companyA: string;
  let companyA2: string;
  let companyB: string;
  let categoryA: string;
  let brandA: string;
  let productA: string;
  let variantA: string;

  const asA = <T>(fn: () => Promise<T>) => TenantContext.run(tenantA, fn);
  const asB = <T>(fn: () => Promise<T>) => TenantContext.run(tenantB, fn);
  const fkViolation = /violates foreign key constraint/;
  const uniqueViolation = /duplicate key value violates unique constraint/;
  const checkViolation = /violates check constraint/;

  async function insertTenant(slug: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO tenants (id, name, slug, updated_at) VALUES (gen_random_uuid(), 'Katalog', $1, now()) RETURNING id",
      [slug],
    );
    return rows[0].id;
  }

  async function insertCompany(tenantId: string, tax: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
       VALUES (gen_random_uuid(), $1, 'Firma', $2, 'Kadıköy', 'Adres', 'Kadıköy', 'İstanbul', now()) RETURNING id`,
      [tenantId, tax],
    );
    return rows[0].id;
  }

  /** Raw insert as tm_app; returns the new id. */
  async function insertProduct(
    tenantId: string,
    companyId: string,
    extra: { categoryId?: string; brandId?: string } = {},
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO products (id, tenant_id, company_id, category_id, brand_id, name, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Ürün', now()) RETURNING id`,
      [tenantId, companyId, extra.categoryId ?? null, extra.brandId ?? null],
    );
    return rows[0].id;
  }

  async function insertVariant(
    tenantId: string,
    companyId: string,
    productId: string,
    sku: string,
    barcode: string | null = null,
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO product_variants (id, tenant_id, company_id, product_id, sku, barcode, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now()) RETURNING id`,
      [tenantId, companyId, productId, sku, barcode],
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    db = appPool();
    base = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    prisma = base.$extends(tenantExtension);

    tenantA = await insertTenant(slugs[0]);
    tenantB = await insertTenant(slugs[1]);
    companyA = await insertCompany(tenantA, '1111111111');
    companyA2 = await insertCompany(tenantA, '2222222222');
    companyB = await insertCompany(tenantB, '1111111111');

    // Tenant A's catalog, written through the tenant-scoped client.
    await asA(async () => {
      const category = await prisma.category.create({
        data: { name: 'Giyim', slug: 'giyim' },
      });
      const brand = await prisma.brand.create({ data: { name: 'Marka' } });
      const product = await prisma.product.create({
        data: {
          companyId: companyA,
          categoryId: category.id,
          brandId: brand.id,
          name: 'Tişört',
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          companyId: companyA,
          productId: product.id,
          sku: 'TS-001',
          barcode: '8690000000011',
        },
      });
      categoryA = category.id;
      brandA = brand.id;
      productA = product.id;
      variantA = variant.id;
    });
  });

  afterAll(async () => {
    await base?.$disconnect();
    await db?.end();
    await purgeTenants(slugs);
  });

  describe('tenant-scoped client', () => {
    it('stamps tenantId on create', async () => {
      const { rows } = await db.query(
        'SELECT tenant_id FROM product_variants WHERE id = $1',
        [variantA],
      );
      expect(rows[0].tenant_id).toBe(tenantA);
    });

    it.each(['category', 'brand', 'product', 'productVariant'] as const)(
      'tenant B cannot list tenant A %s rows',
      async (model) => {
        const rows = await asB(() =>
          (prisma[model] as { findMany: () => Promise<unknown[]> }).findMany(),
        );
        expect(rows).toEqual([]);
      },
    );

    it('tenant B cannot read tenant A product by id', async () => {
      const found = await asB(() =>
        prisma.product.findUnique({ where: { id: productA } }),
      );
      expect(found).toBeNull();
    });

    it('tenant B cannot update or soft-delete tenant A rows', async () => {
      const result = await asB(() =>
        prisma.productVariant.updateMany({
          where: { id: variantA },
          data: { deletedAt: new Date() },
        }),
      );
      expect(result.count).toBe(0);
      await expect(
        asB(() =>
          prisma.product.update({
            where: { id: productA },
            data: { name: 'Ele geçirildi' },
          }),
        ),
      ).rejects.toThrow();
      const { rows } = await db.query(
        'SELECT name FROM products WHERE id = $1',
        [productA],
      );
      expect(rows[0].name).toBe('Tişört');
    });

    it('tenant B cannot create a row for tenant A', async () => {
      await expect(
        asB(() =>
          prisma.brand.create({ data: { tenantId: tenantA, name: 'Sızma' } }),
        ),
      ).rejects.toThrow(/başka bir tenantId/);
    });

    it('tenant A sees its own catalog', async () => {
      const variants = await asA(() =>
        prisma.productVariant.findMany({
          include: { product: { include: { category: true, brand: true } } },
        }),
      );
      expect(variants).toHaveLength(1);
      expect(variants[0].product.category?.id).toBe(categoryA);
      expect(variants[0].product.brand?.id).toBe(brandA);
    });
  });

  describe('composite foreign keys reject cross-tenant references', () => {
    it('product cannot use another tenant company', async () => {
      await expect(insertProduct(tenantB, companyA)).rejects.toThrow(
        fkViolation,
      );
    });

    it('product cannot use another tenant category or brand', async () => {
      await expect(
        insertProduct(tenantB, companyB, { categoryId: categoryA }),
      ).rejects.toThrow(fkViolation);
      await expect(
        insertProduct(tenantB, companyB, { brandId: brandA }),
      ).rejects.toThrow(fkViolation);
    });

    it('variant cannot point at another tenant product', async () => {
      await expect(
        insertVariant(tenantB, companyB, productA, 'X-1'),
      ).rejects.toThrow(fkViolation);
    });

    it('variant company must be its product company', async () => {
      await expect(
        insertVariant(tenantA, companyA2, productA, 'X-2'),
      ).rejects.toThrow(fkViolation);
    });

    it('category parent cannot be in another tenant', async () => {
      await expect(
        db.query(
          `INSERT INTO categories (id, tenant_id, parent_id, name, slug, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'Alt', 'alt', now())`,
          [tenantB, categoryA],
        ),
      ).rejects.toThrow(fkViolation);
    });

    it('category cannot be its own parent', async () => {
      await expect(
        db.query('UPDATE categories SET parent_id = id WHERE id = $1', [
          categoryA,
        ]),
      ).rejects.toThrow(checkViolation);
    });
  });

  describe('uniqueness', () => {
    it('SKU is unique within a tenant, across its companies', async () => {
      const other = await insertProduct(tenantA, companyA2);
      await expect(
        insertVariant(tenantA, companyA2, other, 'TS-001'),
      ).rejects.toThrow(uniqueViolation);
    });

    it('barcode is unique within a tenant', async () => {
      const other = await insertProduct(tenantA, companyA2);
      await expect(
        insertVariant(tenantA, companyA2, other, 'TS-002', '8690000000011'),
      ).rejects.toThrow(uniqueViolation);
    });

    it('variants without a barcode do not collide', async () => {
      await insertVariant(tenantA, companyA, productA, 'TS-003');
      await insertVariant(tenantA, companyA, productA, 'TS-004');
    });

    it('another tenant may reuse the same SKU and barcode', async () => {
      const product = await insertProduct(tenantB, companyB);
      await insertVariant(
        tenantB,
        companyB,
        product,
        'TS-001',
        '8690000000011',
      );
    });

    it('category slug and brand name are unique within a tenant', async () => {
      await expect(
        db.query(
          `INSERT INTO categories (id, tenant_id, name, slug, updated_at)
           VALUES (gen_random_uuid(), $1, 'Giyim 2', 'giyim', now())`,
          [tenantA],
        ),
      ).rejects.toThrow(uniqueViolation);
      await expect(
        db.query(
          `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'Marka', now())`,
          [tenantA],
        ),
      ).rejects.toThrow(uniqueViolation);
      await db.query(
        `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'Marka', now())`,
        [tenantB],
      );
    });

    it.each([
      ['empty SKU', 'sku', '   '],
      ['empty barcode', 'barcode', ''],
    ])('rejects %s', async (_label, column, value) => {
      await expect(
        db.query(`UPDATE product_variants SET ${column} = $2 WHERE id = $1`, [
          variantA,
          value,
        ]),
      ).rejects.toThrow(checkViolation);
    });

    it.each([
      ['SKU', 'sku', ' TS-001 '],
      ['barcode', 'barcode', '8690000000011 '],
    ])(
      'rejects a %s with surrounding whitespace',
      async (_l, column, value) => {
        await expect(
          db.query(`UPDATE product_variants SET ${column} = $2 WHERE id = $1`, [
            variantA,
            value,
          ]),
        ).rejects.toThrow(checkViolation);
      },
    );

    it('a soft-deleted SKU and barcode still cannot be reused', async () => {
      const product = await insertProduct(tenantA, companyA);
      const old = await insertVariant(
        tenantA,
        companyA,
        product,
        'DEL-001',
        '8690000000099',
      );
      await db.query(
        'UPDATE product_variants SET deleted_at = now() WHERE id = $1',
        [old],
      );
      await expect(
        insertVariant(tenantA, companyA, product, 'DEL-001'),
      ).rejects.toThrow(uniqueViolation);
      await expect(
        insertVariant(tenantA, companyA, product, 'DEL-002', '8690000000099'),
      ).rejects.toThrow(uniqueViolation);
    });

    it('SKU is case-sensitive', async () => {
      await insertVariant(tenantA, companyA, productA, 'ts-001');
    });

    it('brand name is unique case-insensitively', async () => {
      await expect(
        db.query(
          `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'MARKA', now())`,
          [tenantA],
        ),
      ).rejects.toThrow(uniqueViolation);
    });

    it.each([' Marka', 'Marka ', '   '])(
      'rejects brand name %j (untrimmed or blank)',
      async (name) => {
        await expect(
          db.query(
            `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, $2, now())`,
            [tenantA, name],
          ),
        ).rejects.toThrow(checkViolation);
      },
    );

    it('a brand and a category can be recreated after soft delete', async () => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'Eski', now()) RETURNING id`,
        [tenantA],
      );
      const cat = await db.query<{ id: string }>(
        `INSERT INTO categories (id, tenant_id, name, slug, updated_at)
         VALUES (gen_random_uuid(), $1, 'Eski', 'eski', now()) RETURNING id`,
        [tenantA],
      );
      await db.query('UPDATE brands SET deleted_at = now() WHERE id = $1', [
        rows[0].id,
      ]);
      await db.query('UPDATE categories SET deleted_at = now() WHERE id = $1', [
        cat.rows[0].id,
      ]);
      await db.query(
        `INSERT INTO brands (id, tenant_id, name, updated_at) VALUES (gen_random_uuid(), $1, 'eski', now())`,
        [tenantA],
      );
      await db.query(
        `INSERT INTO categories (id, tenant_id, name, slug, updated_at)
         VALUES (gen_random_uuid(), $1, 'Eski', 'eski', now())`,
        [tenantA],
      );
    });

    it('rejects an invalid category slug', async () => {
      await expect(
        db.query("UPDATE categories SET slug = 'Büyük Harf' WHERE id = $1", [
          categoryA,
        ]),
      ).rejects.toThrow(checkViolation);
    });
  });
});
