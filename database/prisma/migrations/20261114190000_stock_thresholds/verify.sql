-- INV-03 post-migration checks for database/scripts/backup-and-rehearse.sh (rows: name|t/f|detail).
SELECT 'table_exists', (to_regclass('public.stock_thresholds') IS NOT NULL)::text::char, 'stock_thresholds';
SELECT 'app_grants', (has_table_privilege('tm_app', 'stock_thresholds', 'SELECT') AND has_table_privilege('tm_app', 'stock_thresholds', 'INSERT') AND has_table_privilege('tm_app', 'stock_thresholds', 'UPDATE') AND has_table_privilege('tm_app', 'stock_thresholds', 'DELETE') AND NOT has_table_privilege('tm_app', 'stock_thresholds', 'TRUNCATE'))::text::char, 'tm_app S/I/U/D, TRUNCATE yok';
SELECT 'threshold_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_thresholds_threshold_range')::text::char, 'CHECK 0..1000000';
