-- Undo of 20261114170000_stock_reservations. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any reservation exists (restore from backup).

BEGIN;

LOCK TABLE "stock_reservations", "stock_levels" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "stock_reservations") OR EXISTS (SELECT 1 FROM "stock_levels" WHERE "reserved" <> 0) THEN
    RAISE EXCEPTION 'rezervasyon verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP FUNCTION "stock_consume"(uuid, uuid, uuid);
DROP FUNCTION "stock_release"(uuid, uuid);
DROP FUNCTION "stock_reserve"(uuid, uuid, uuid, integer);
ALTER TABLE "stock_levels" DROP CONSTRAINT "stock_levels_reserved_within_on_hand";
DROP TABLE "stock_reservations";
DROP INDEX "order_items_tenant_id_company_id_id_key";

COMMIT;
