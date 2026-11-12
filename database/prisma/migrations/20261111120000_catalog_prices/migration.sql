-- CAT-05 prices: products.vat_rate and variant_prices (list price + channel prices,
-- NUMERIC(12,2) + currency, VAT-inclusive). Additive only. Undo: down.sql.
-- Generated with `prisma migrate diff`, then edited: known role_scope drift removed;
-- partial unique index, CHECKs and grants added by hand.

ALTER TABLE "products" ADD COLUMN     "vat_rate" DECIMAL(5,2);



-- CreateTable
CREATE TABLE "variant_prices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "variant_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variant_prices_tenant_id_variant_id_idx" ON "variant_prices"("tenant_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_prices_tenant_id_id_key" ON "variant_prices"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_tenant_id_variant_id_fkey" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "product_variants"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- SQL-only unique index and CHECKs ------------------------------------------------
CREATE UNIQUE INDEX "variant_prices_tenant_id_variant_id_channel_active_key" ON "variant_prices"("tenant_id", "variant_id", "channel") WHERE "deleted_at" IS NULL;
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_amount_non_negative" CHECK ("amount" >= 0);
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "variant_prices" ADD CONSTRAINT "variant_prices_channel_format" CHECK ("channel" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "products" ADD CONSTRAINT "products_vat_rate_range" CHECK ("vat_rate" IS NULL OR ("vat_rate" >= 0 AND "vat_rate" <= 100));

-- Application role privileges: prices are soft-deleted, never deleted.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "variant_prices" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "variant_prices" TO tm_app;
  END IF;
END $$;
