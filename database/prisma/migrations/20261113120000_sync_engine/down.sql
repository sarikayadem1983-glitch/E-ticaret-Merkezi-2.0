-- Undo of 20261113120000_sync_engine. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any sync data exists (restore from backup).

BEGIN;

LOCK TABLE "sync_jobs", "channel_external_refs" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sync_jobs") OR EXISTS (SELECT 1 FROM "channel_external_refs") THEN
    RAISE EXCEPTION 'senkron verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "channel_external_refs";
DROP TABLE "sync_jobs";
DROP INDEX "channel_accounts_tenant_id_company_id_id_key";

COMMIT;
