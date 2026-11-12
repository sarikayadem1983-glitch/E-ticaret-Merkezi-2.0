-- Undo of 20261112130000_channel_accounts. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any channel account exists (restore from backup).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "channel_accounts") THEN
    RAISE EXCEPTION 'kanal hesabı verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "channel_accounts";
UPDATE "roles" SET "permissions" = array_remove("permissions", 'channels:manage')
WHERE 'channels:manage' = ANY("permissions");

COMMIT;
