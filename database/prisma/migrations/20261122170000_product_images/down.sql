-- Undo of 20261122170000_product_images. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any image row exists (restore from backup).

BEGIN;

LOCK TABLE "product_images" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "product_images") THEN
    RAISE EXCEPTION 'görsel kaydı var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "product_images";

COMMIT;
