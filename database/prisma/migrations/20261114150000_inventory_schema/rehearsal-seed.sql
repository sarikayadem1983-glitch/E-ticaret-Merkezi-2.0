-- Test rows for the down.sql stop check in database/scripts/backup-and-rehearse.sh. Runs only on a
-- throwaway tm_ rehearsal copy. One tenant/company/product/variant/warehouse and one movement.
BEGIN;
INSERT INTO tenants (id, name, slug, updated_at) VALUES ('00000000-0000-4000-8000-0000000051a1', 'rehearsal-stock', 'rehearsal-stock-tenant', now());
INSERT INTO companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000051a2', '00000000-0000-4000-8000-0000000051a1', 'Prova', '1234567890', 'X', 'Y', 'Z', 'W', now());
INSERT INTO products (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000051a3', '00000000-0000-4000-8000-0000000051a1', '00000000-0000-4000-8000-0000000051a2', 'Prova', now());
INSERT INTO product_variants (id, tenant_id, company_id, product_id, sku, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000051a4', '00000000-0000-4000-8000-0000000051a1', '00000000-0000-4000-8000-0000000051a2', '00000000-0000-4000-8000-0000000051a3', 'REHEARSAL-STOCK-1', now());
INSERT INTO warehouses (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000051a5', '00000000-0000-4000-8000-0000000051a1', '00000000-0000-4000-8000-0000000051a2', 'Prova', now());
INSERT INTO stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000051a1', '00000000-0000-4000-8000-0000000051a2', '00000000-0000-4000-8000-0000000051a5', '00000000-0000-4000-8000-0000000051a4', 5, 'opening');
COMMIT;
