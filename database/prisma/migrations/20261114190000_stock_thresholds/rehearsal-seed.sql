-- Test rows for the down.sql stop check (throwaway tm_ rehearsal copy only).
BEGIN;
INSERT INTO tenants (id, name, slug, updated_at) VALUES ('00000000-0000-4000-8000-0000000053c1', 'rehearsal-thr', 'rehearsal-thr-tenant', now());
INSERT INTO companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000053c2', '00000000-0000-4000-8000-0000000053c1', 'Prova', '1234567890', 'X', 'Y', 'Z', 'W', now());
INSERT INTO products (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000053c3', '00000000-0000-4000-8000-0000000053c1', '00000000-0000-4000-8000-0000000053c2', 'Prova', now());
INSERT INTO product_variants (id, tenant_id, company_id, product_id, sku, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000053c4', '00000000-0000-4000-8000-0000000053c1', '00000000-0000-4000-8000-0000000053c2', '00000000-0000-4000-8000-0000000053c3', 'REHEARSAL-THR-1', now());
INSERT INTO stock_thresholds (id, tenant_id, company_id, variant_id, threshold, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000053c1', '00000000-0000-4000-8000-0000000053c2', '00000000-0000-4000-8000-0000000053c4', 3, now());
COMMIT;
