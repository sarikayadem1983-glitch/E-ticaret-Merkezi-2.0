-- Undo of 20261111120000_catalog_prices. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any price or VAT rate exists (restore from backup).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "variant_prices") OR EXISTS (SELECT 1 FROM "products" WHERE "vat_rate" IS NOT NULL) THEN
    RAISE EXCEPTION 'fiyat verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "variant_prices";
ALTER TABLE "products" DROP CONSTRAINT "products_vat_rate_range";
ALTER TABLE "products" DROP COLUMN "vat_rate";

COMMIT;
