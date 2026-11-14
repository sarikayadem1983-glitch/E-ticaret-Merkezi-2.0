-- Undo of 20261114150000_inventory_schema. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any inventory data exists (restore from backup).

BEGIN;

LOCK TABLE "warehouses", "stock_levels", "stock_movements" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "warehouses") OR EXISTS (SELECT 1 FROM "stock_levels") OR EXISTS (SELECT 1 FROM "stock_movements") THEN
    RAISE EXCEPTION 'stok verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TRIGGER "stock_movements_apply" ON "stock_movements";
DROP FUNCTION "stock_movements_apply"();
DROP TABLE "stock_movements";
DROP TABLE "stock_levels";
DROP TABLE "warehouses";

COMMIT;
