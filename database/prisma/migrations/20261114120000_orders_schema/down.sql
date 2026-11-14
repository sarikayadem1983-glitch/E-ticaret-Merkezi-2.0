-- Undo of 20261114120000_orders_schema. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any order data exists (restore from backup).

BEGIN;

LOCK TABLE "orders", "order_items", "order_status_history" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "orders") OR EXISTS (SELECT 1 FROM "order_items") OR EXISTS (SELECT 1 FROM "order_status_history") THEN
    RAISE EXCEPTION 'sipariş verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "order_status_history";
DROP TABLE "order_items";
DROP TABLE "orders";
DROP INDEX "channel_accounts_tenant_id_company_id_channel_id_key";

COMMIT;
