SELECT 'purchase_cost_columns', (count(*) = 3)::text::char, 'nullable variant cost columns'
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_variants'
AND column_name IN ('purchase_cost','cost_currency','purchase_cost_updated_at') AND is_nullable = 'YES';
SELECT 'purchase_cost_check', EXISTS (SELECT 1 FROM pg_constraint
WHERE conrelid = 'product_variants'::regclass AND conname = 'product_variants_purchase_cost_valid')::text::char,
'nonnegative, currency and null consistency';
