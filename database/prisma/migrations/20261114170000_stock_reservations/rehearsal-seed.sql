-- Test rows for the down.sql stop check in database/scripts/backup-and-rehearse.sh. Runs only on a
-- throwaway tm_ rehearsal copy: one order line with an active reservation.
BEGIN;
INSERT INTO tenants (id, name, slug, updated_at) VALUES ('00000000-0000-4000-8000-0000000052b1', 'rehearsal-res', 'rehearsal-res-tenant', now());
INSERT INTO companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b2', '00000000-0000-4000-8000-0000000052b1', 'Prova', '1234567890', 'X', 'Y', 'Z', 'W', now());
INSERT INTO products (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b3', '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', 'Prova', now());
INSERT INTO product_variants (id, tenant_id, company_id, product_id, sku, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b4', '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', '00000000-0000-4000-8000-0000000052b3', 'REHEARSAL-RES-1', now());
INSERT INTO warehouses (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b5', '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', 'Prova', now());
INSERT INTO stock_movements (id, tenant_id, company_id, warehouse_id, variant_id, quantity, reason)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', '00000000-0000-4000-8000-0000000052b5', '00000000-0000-4000-8000-0000000052b4', 5, 'opening');
INSERT INTO orders (id, tenant_id, company_id, channel, currency, subtotal, total, ordered_at, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b6', '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', 'manual', 'TRY', 0, 0, now(), now());
INSERT INTO order_items (id, tenant_id, company_id, order_id, variant_id, sku, name, quantity, unit_price, line_total, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000052b7', '00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b2', '00000000-0000-4000-8000-0000000052b6', '00000000-0000-4000-8000-0000000052b4', 'S', 'Prova', 2, 0, 0, now());
SELECT stock_reserve('00000000-0000-4000-8000-0000000052b1', '00000000-0000-4000-8000-0000000052b7', '00000000-0000-4000-8000-0000000052b5', 2);
COMMIT;
