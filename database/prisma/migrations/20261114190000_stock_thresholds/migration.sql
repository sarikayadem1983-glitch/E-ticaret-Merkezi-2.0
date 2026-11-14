-- INV-03 low-stock thresholds per variant. Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then the CHECK and grants added by hand.
-- CreateTable
CREATE TABLE "stock_thresholds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "threshold" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_thresholds_tenant_id_company_id_idx" ON "stock_thresholds"("tenant_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_thresholds_tenant_id_id_key" ON "stock_thresholds"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_thresholds_tenant_id_variant_id_key" ON "stock_thresholds"("tenant_id", "variant_id");

-- AddForeignKey
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_tenant_id_company_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "variant_id") REFERENCES "product_variants"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- SQL-only CHECKs ------------------------------------------------------------------
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_threshold_range" CHECK ("threshold" >= 0 AND "threshold" <= 1000000);

-- Application role privileges: thresholds are settings; the app may remove them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "stock_thresholds" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_thresholds" TO tm_app;
  END IF;
END $$;
