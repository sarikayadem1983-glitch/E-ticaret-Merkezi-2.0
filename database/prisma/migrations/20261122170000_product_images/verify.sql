-- IMG-01 post-migration checks for database/scripts/backup-and-rehearse.sh (rows: name|t/f|detail).
SELECT 'table_exists', (to_regclass('public.product_images') IS NOT NULL)::text::char, 'product_images';
SELECT 'app_grants', (has_table_privilege('tm_app', 'product_images', 'SELECT') AND has_table_privilege('tm_app', 'product_images', 'INSERT') AND has_table_privilege('tm_app', 'product_images', 'UPDATE') AND NOT has_table_privilege('tm_app', 'product_images', 'DELETE') AND NOT has_table_privilege('tm_app', 'product_images', 'TRUNCATE'))::text::char, 'tm_app S/I/U; DELETE, TRUNCATE yok';
SELECT 'variant_fk', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'product_images'::regclass AND confrelid = 'product_variants'::regclass AND cardinality(conkey) = 4)::text::char, 'varyant aynı ürünün';
SELECT 'key_tenant_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_images_key_tenant')::text::char, 'anahtar tenant öneki';
