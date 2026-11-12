-- CAT-06 channel category mapping: channel category trees and their attributes (per tenant
-- and channel), our category → channel category, our attribute → channel attribute, and
-- product-level channel attribute values. Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then CHECKs, partial indexes and grants added by hand.

-- CreateTable
CREATE TABLE "channel_categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "parent_external_id" VARCHAR(64),
    "name" VARCHAR(200) NOT NULL,
    "is_leaf" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "channel_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_category_attributes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel_category_id" UUID NOT NULL,
    "external_id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "required" BOOLEAN NOT NULL,
    "varies_by_variant" BOOLEAN NOT NULL,
    "allow_custom" BOOLEAN NOT NULL,
    "allowed_values" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "channel_category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_channel_mappings" (
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "channel_category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "category_channel_mappings_pkey" PRIMARY KEY ("tenant_id","category_id","channel")
);

-- CreateTable
CREATE TABLE "attribute_channel_mappings" (
    "tenant_id" UUID NOT NULL,
    "channel_category_attribute_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attribute_channel_mappings_pkey" PRIMARY KEY ("tenant_id","channel_category_attribute_id")
);

-- CreateTable
CREATE TABLE "product_channel_attribute_values" (
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "channel_category_attribute_id" UUID NOT NULL,
    "value_external_id" VARCHAR(64),
    "value" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_channel_attribute_values_pkey" PRIMARY KEY ("tenant_id","product_id","channel_category_attribute_id")
);

-- CreateIndex
CREATE INDEX "channel_categories_tenant_id_channel_parent_external_id_idx" ON "channel_categories"("tenant_id", "channel", "parent_external_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_categories_tenant_id_id_key" ON "channel_categories"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_categories_tenant_id_channel_external_id_key" ON "channel_categories"("tenant_id", "channel", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_category_attributes_tenant_id_id_key" ON "channel_category_attributes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_category_attributes_tenant_id_channel_category_id_e_key" ON "channel_category_attributes"("tenant_id", "channel_category_id", "external_id");

-- CreateIndex
CREATE INDEX "attribute_channel_mappings_tenant_id_attribute_id_idx" ON "attribute_channel_mappings"("tenant_id", "attribute_id");

-- AddForeignKey
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_category_attributes" ADD CONSTRAINT "channel_category_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_category_attributes" ADD CONSTRAINT "channel_category_attributes_tenant_id_channel_category_id_fkey" FOREIGN KEY ("tenant_id", "channel_category_id") REFERENCES "channel_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_channel_mappings" ADD CONSTRAINT "category_channel_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_channel_mappings" ADD CONSTRAINT "category_channel_mappings_tenant_id_category_id_fkey" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_channel_mappings" ADD CONSTRAINT "category_channel_mappings_tenant_id_channel_category_id_fkey" FOREIGN KEY ("tenant_id", "channel_category_id") REFERENCES "channel_categories"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_channel_mappings" ADD CONSTRAINT "attribute_channel_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_channel_mappings" ADD CONSTRAINT "attribute_channel_mappings_tenant_id_channel_category_attr_fkey" FOREIGN KEY ("tenant_id", "channel_category_attribute_id") REFERENCES "channel_category_attributes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_channel_mappings" ADD CONSTRAINT "attribute_channel_mappings_tenant_id_attribute_id_fkey" FOREIGN KEY ("tenant_id", "attribute_id") REFERENCES "attributes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_channel_attribute_values" ADD CONSTRAINT "product_channel_attribute_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_channel_attribute_values" ADD CONSTRAINT "product_channel_attribute_values_tenant_id_product_id_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_channel_attribute_values" ADD CONSTRAINT "product_channel_attribute_values_tenant_id_channel_categor_fkey" FOREIGN KEY ("tenant_id", "channel_category_attribute_id") REFERENCES "channel_category_attributes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_channel_format" CHECK ("channel" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_external_id_not_blank" CHECK (length(btrim("external_id")) > 0);
ALTER TABLE "channel_categories" ADD CONSTRAINT "channel_categories_not_own_parent" CHECK ("parent_external_id" IS NULL OR "parent_external_id" <> "external_id");
ALTER TABLE "channel_category_attributes" ADD CONSTRAINT "channel_category_attributes_values_array" CHECK (jsonb_typeof("allowed_values") = 'array');
ALTER TABLE "category_channel_mappings" ADD CONSTRAINT "category_channel_mappings_channel_format" CHECK ("channel" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "product_channel_attribute_values" ADD CONSTRAINT "product_channel_attribute_values_value_not_blank" CHECK (length(btrim("value")) > 0);

-- Application role privileges. Trees and attributes are soft-deleted (replaced by import);
-- mappings and product values are removed when the user clears them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "channel_categories", "channel_category_attributes" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "channel_categories", "channel_category_attributes" TO tm_app;
    REVOKE ALL ON "category_channel_mappings", "attribute_channel_mappings", "product_channel_attribute_values" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "category_channel_mappings", "attribute_channel_mappings", "product_channel_attribute_values" TO tm_app;
  END IF;
END $$;
