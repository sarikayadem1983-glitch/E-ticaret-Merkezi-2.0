# Veritabanı

> Veritabanı motoru: PostgreSQL. ORM: Prisma. Bu doküman taslak şemadır; migration yazılmadan önce kesinleştirilecek.

## Multi-tenant

- `tenants` tablosu: id, name, slug (unique), plan, is_active.
- `tenants` dışındaki tüm iş tablolarında `tenant_id` zorunludur ve indekslidir.
- Tekil alanlar tenant içinde tekildir: örn. `(tenant_id, sku)`.
- `refresh_tokens` — id, user_id, token_hash, expires_at, revoked_at.

## Kurallar

- Tablo adları İngilizce, çoğul, `snake_case`: `products`, `order_items`.
- Birincil anahtar: `id` (UUID).
- Her tabloda `created_at`, `updated_at` bulunur.
- Silinebilir kayıtlarda `deleted_at` (soft delete).
- Yabancı anahtar adı: `<tablo_tekil>_id`.
- Para: `NUMERIC(12,2)` + `currency CHAR(3)`.

## Taslak Tablolar

### auth
- `users` — id, name, email (unique), password_hash, is_active
- `roles` — id, name
- `user_roles` — user_id, role_id

### catalog
- `categories` — id, parent_id, name, slug
- `brands` — id, name
- `products` — id, brand_id, category_id, name, description, status
- `product_variants` — id, product_id, sku (unique), barcode, price, currency

### inventory
- `warehouses` — id, name
- `stock_levels` — variant_id, warehouse_id, quantity
- `stock_movements` — id, variant_id, warehouse_id, change, reason, reference

### channels
- `channels` — id, type, name, credentials_ref, is_active
- `channel_listings` — id, channel_id, variant_id, external_id, price, sync_status

### customers
- `customers` — id, name, email, phone
- `addresses` — id, customer_id, type, address fields

### orders
- `orders` — id, channel_id, customer_id, external_order_no, status, total, currency, ordered_at
- `order_items` — id, order_id, variant_id, quantity, unit_price
- `order_status_history` — id, order_id, from_status, to_status, changed_at

## Notlar

- Pazaryeri kimlik bilgileri veritabanında düz metin tutulmaz; şifreli saklanır veya gizli bilgi yöneticisinde referanslanır.
- Migration ve seed dosyaları `database/` klasöründe tutulur.
