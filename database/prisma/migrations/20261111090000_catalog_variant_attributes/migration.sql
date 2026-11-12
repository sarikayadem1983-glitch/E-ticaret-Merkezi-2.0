-- CAT-03 variant attributes: attributes (colour, size…), their values, and the value each
-- variant has per attribute. Additive only; no existing table or row changes. Undo: down.sql.
-- Generated with `prisma migrate diff`, then edited: the known role_scope drift of earlier
-- migrations is removed; partial/expression unique indexes, CHECKs and grants added by hand.

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_values" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_attribute_values" (
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "attribute_value_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "variant_attribute_values_pkey" PRIMARY KEY ("variant_id","attribute_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attributes_tenant_id_id_key" ON "attributes"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_values_tenant_id_id_key" ON "attribute_values"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_values_tenant_id_attribute_id_id_key" ON "attribute_values"("tenant_id", "attribute_id", "id");

-- CreateIndex
CREATE INDEX "variant_attribute_values_tenant_id_attribute_value_id_idx" ON "variant_attribute_values"("tenant_id", "attribute_value_id");

-- AddForeignKey
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_tenant_id_attribute_id_fkey" FOREIGN KEY ("tenant_id", "attribute_id") REFERENCES "attributes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_tenant_id_attribute_id_attribute__fkey" FOREIGN KEY ("tenant_id", "attribute_id", "attribute_value_id") REFERENCES "attribute_values"("tenant_id", "attribute_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- SQL-only unique indexes and CHECKs (Prisma cannot express them) ----------------
CREATE UNIQUE INDEX "attributes_tenant_id_name_active_key" ON "attributes"("tenant_id", lower(btrim("name"))) WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "attribute_values_tenant_id_attribute_id_value_active_key" ON "attribute_values"("tenant_id", "attribute_id", lower(btrim("value"))) WHERE "deleted_at" IS NULL;
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_name_trimmed" CHECK ("name" = btrim("name") AND "name" <> '');
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_value_trimmed" CHECK ("value" = btrim("value") AND "value" <> '');
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_sort_order_range" CHECK ("sort_order" BETWEEN 0 AND 10000);

-- Application role privileges: soft delete only, link rows are updated, never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "attributes", "attribute_values", "variant_attribute_values" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "attributes", "attribute_values", "variant_attribute_values" TO tm_app;
  END IF;
END $$;
