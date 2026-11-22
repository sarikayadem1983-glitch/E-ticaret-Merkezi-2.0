-- IMG-01 product images. Additive only. Undo: down.sql.
-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" VARCHAR(300) NOT NULL,
    "content_type" VARCHAR(20) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_images_tenant_id_company_id_product_id_idx" ON "product_images"("tenant_id", "company_id", "product_id");
CREATE INDEX "product_images_tenant_id_company_id_variant_id_idx" ON "product_images"("tenant_id", "company_id", "variant_id");
CREATE UNIQUE INDEX "product_images_tenant_id_id_key" ON "product_images"("tenant_id", "id");
CREATE UNIQUE INDEX "product_images_storage_key_key" ON "product_images"("storage_key");

-- Target of the image FK below. Additive: id is already unique.
CREATE UNIQUE INDEX "product_variants_tenant_id_company_id_product_id_id_key" ON "product_variants"("tenant_id", "company_id", "product_id", "id");

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_company_id_product_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "product_id") REFERENCES "products"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_company_id_product_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "product_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "product_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only CHECKs. The storage key must be inside the row's own tenant prefix.
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_key_tenant" CHECK (starts_with("storage_key", 'tenants/' || "tenant_id"::text || '/'));
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_type" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_numbers" CHECK ("width" > 0 AND "height" > 0 AND "byte_size" > 0 AND "position" >= 0);

-- Application role: rows are soft-deleted, never removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "product_images" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "product_images" TO tm_app;
  END IF;
END $$;
