-- Undo of 20261111090000_catalog_variant_attributes. Run as tm_migrator, then remove the
-- row from _prisma_migrations. Refuses to run while any attribute row exists: data is never
-- dropped by a rollback (restore from backup instead).

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "attributes") OR EXISTS (SELECT 1 FROM "attribute_values")
     OR EXISTS (SELECT 1 FROM "variant_attribute_values") THEN
    RAISE EXCEPTION 'özellik verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "variant_attribute_values";
DROP TABLE "attribute_values";
DROP TABLE "attributes";

COMMIT;
