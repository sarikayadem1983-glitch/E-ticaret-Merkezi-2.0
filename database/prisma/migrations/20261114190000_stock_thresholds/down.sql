-- Undo of 20261114190000_stock_thresholds. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any threshold exists (restore from backup).

BEGIN;

LOCK TABLE "stock_thresholds" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "stock_thresholds") THEN
    RAISE EXCEPTION 'eşik verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "stock_thresholds";

COMMIT;
