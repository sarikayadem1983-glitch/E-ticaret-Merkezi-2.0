-- Undo of 20261112190000_channel_mapping. Run as tm_migrator, then remove the row from
-- _prisma_migrations. Refuses to run while any mapping data exists (restore from backup).

BEGIN;

LOCK TABLE "channel_categories", "channel_category_attributes", "category_channel_mappings",
  "attribute_channel_mappings", "product_channel_attribute_values" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "channel_categories") OR EXISTS (SELECT 1 FROM "product_channel_attribute_values") THEN
    RAISE EXCEPTION 'kanal eşleme verisi var; down.sql durdu, hiçbir değişiklik yapılmadı';
  END IF;
END $$;

DROP TABLE "product_channel_attribute_values";
DROP TABLE "attribute_channel_mappings";
DROP TABLE "category_channel_mappings";
DROP TABLE "channel_category_attributes";
DROP TABLE "channel_categories";

COMMIT;
