-- Run only in an approved rollback; refuses to discard populated purchase costs.
BEGIN;
LOCK TABLE "product_variants" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "product_variants" WHERE "purchase_cost" IS NOT NULL) THEN
    RAISE EXCEPTION 'Purchase cost records exist; restore a backup or preserve the records before rollback';
  END IF;
END $$;
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_purchase_cost_valid",
  DROP COLUMN "purchase_cost", DROP COLUMN "cost_currency", DROP COLUMN "purchase_cost_updated_at";
COMMIT;
