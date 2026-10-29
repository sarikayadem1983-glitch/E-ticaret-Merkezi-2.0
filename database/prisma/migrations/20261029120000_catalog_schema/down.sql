-- Undo of 20261029120000_catalog_schema. Run as tm_migrator, then remove the row
-- from _prisma_migrations. Refuses to run while any catalog row exists: catalog
-- data is never dropped by a rollback (restore from backup instead).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "categories") OR EXISTS (SELECT 1 FROM "brands")
     OR EXISTS (SELECT 1 FROM "products") OR EXISTS (SELECT 1 FROM "product_variants") THEN
    RAISE EXCEPTION 'katalog verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "product_variants";
DROP TABLE "products";
DROP TABLE "brands";
DROP TABLE "categories";
DROP TYPE "product_status";

UPDATE "roles" SET "permissions" = array_remove(array_remove("permissions", 'products:read'), 'products:write')
WHERE "key" IS NOT NULL AND "permissions" && ARRAY['products:read', 'products:write'];

COMMIT;
