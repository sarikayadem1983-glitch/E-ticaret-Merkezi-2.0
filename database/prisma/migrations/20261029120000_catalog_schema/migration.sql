-- CAT-01 catalog schema: categories, brands, products, product variants (SKU / barcode).
-- Additive only; no existing table or row is changed except roles.permissions (informational
-- copy of backend/src/access/roles.catalog.ts). Undo: down.sql in this folder.
-- Generated with `prisma migrate diff`, then edited: SQL-only objects of earlier
-- migrations (role_scope columns/FKs) are not touched; partial/expression unique indexes,
-- CHECKs and grants are added by hand.

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID,
    "brand_id" UUID,
    "name" VARCHAR(250) NOT NULL,
    "description" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "barcode" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenant_id_parent_id_idx" ON "categories"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_id_key" ON "categories"("tenant_id", "id");

-- Unique among non-deleted rows: a soft-deleted category's slug can be reused (SQL-only).
CREATE UNIQUE INDEX "categories_tenant_id_slug_active_key" ON "categories"("tenant_id", "slug") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenant_id_id_key" ON "brands"("tenant_id", "id");

-- Case-insensitive, trimmed, among non-deleted rows (SQL-only).
CREATE UNIQUE INDEX "brands_tenant_id_name_active_key" ON "brands"("tenant_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "products_tenant_id_company_id_status_idx" ON "products"("tenant_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_brand_id_idx" ON "products"("tenant_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_id_key" ON "products"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_company_id_id_key" ON "products"("tenant_id", "company_id", "id");

-- CreateIndex
CREATE INDEX "product_variants_tenant_id_company_id_product_id_idx" ON "product_variants"("tenant_id", "company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_id_key" ON "product_variants"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "product_variants"("tenant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_barcode_key" ON "product_variants"("tenant_id", "barcode");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "categories"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_brand_id_fkey" FOREIGN KEY ("tenant_id", "brand_id") REFERENCES "brands"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_company_id_product_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "product_id") REFERENCES "products"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- SQL-only CHECKs (Prisma cannot express them) -----------------------------------

ALTER TABLE "categories" ADD CONSTRAINT "categories_no_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
-- Lowercase only (no A-Z in the pattern), so slug uniqueness is effectively case-insensitive.
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "brands" ADD CONSTRAINT "brands_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_not_blank" CHECK (btrim("sku") <> '');
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_barcode_not_blank" CHECK ("barcode" IS NULL OR btrim("barcode") <> '');
-- SKU and barcode are exact strings (case-sensitive, as marketplaces match them); no surrounding whitespace.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_trimmed" CHECK ("sku" = btrim("sku"));
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_barcode_trimmed" CHECK ("barcode" IS NULL OR "barcode" = btrim("barcode"));

-- System role permissions (runtime source is roles.catalog.ts) --------------------

UPDATE "roles" SET "permissions" = "permissions" || ARRAY['products:read']
WHERE "key" IN ('admin', 'operations', 'accounting', 'viewer') AND NOT ('products:read' = ANY("permissions"));
UPDATE "roles" SET "permissions" = "permissions" || ARRAY['products:write']
WHERE "key" IN ('admin', 'operations') AND NOT ('products:write' = ANY("permissions"));

-- Application role privileges: catalog rows are soft-deleted (deleted_at), never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "categories", "brands", "products", "product_variants" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "categories", "brands", "products", "product_variants" TO tm_app;
  END IF;
END $$;
