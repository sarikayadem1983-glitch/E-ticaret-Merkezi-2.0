-- Test rows for the down.sql stop check (throwaway tm_ rehearsal copy only).
BEGIN;
INSERT INTO tenants (id, name, slug, updated_at) VALUES ('00000000-0000-4000-8000-0000000056d1', 'rehearsal-img', 'rehearsal-img-tenant', now());
INSERT INTO companies (id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000056d2', '00000000-0000-4000-8000-0000000056d1', 'Prova', '1234567890', 'X', 'Y', 'Z', 'W', now());
INSERT INTO products (id, tenant_id, company_id, name, updated_at)
  VALUES ('00000000-0000-4000-8000-0000000056d3', '00000000-0000-4000-8000-0000000056d1', '00000000-0000-4000-8000-0000000056d2', 'Prova', now());
INSERT INTO product_images (id, tenant_id, company_id, product_id, storage_key, content_type, width, height, byte_size, position, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-4000-8000-0000000056d1', '00000000-0000-4000-8000-0000000056d2', '00000000-0000-4000-8000-0000000056d3', 'tenants/00000000-0000-4000-8000-0000000056d1/products/x/y.png', 'image/png', 100, 100, 10, 0, now());
COMMIT;
