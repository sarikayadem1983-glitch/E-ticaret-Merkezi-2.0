-- RPT-02 prerequisite. Additive; old variants retain unknown (NULL) costs.
ALTER TABLE "product_variants"
  ADD COLUMN "purchase_cost" NUMERIC(12,2),
  ADD COLUMN "cost_currency" CHAR(3),
  ADD COLUMN "purchase_cost_updated_at" TIMESTAMPTZ;

ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_purchase_cost_valid"
CHECK (
  ("purchase_cost" IS NULL AND "cost_currency" IS NULL AND "purchase_cost_updated_at" IS NULL)
  OR
  ("purchase_cost" IS NOT NULL AND "purchase_cost" >= 0 AND "purchase_cost" <= 9999999999.99
   AND "cost_currency" IS NOT NULL AND "cost_currency" IN ('TRY','USD','EUR')
   AND "purchase_cost_updated_at" IS NOT NULL)
);
