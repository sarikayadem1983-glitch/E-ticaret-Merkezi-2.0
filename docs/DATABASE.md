# Veritabanı

> Veritabanı motoru: PostgreSQL. ORM: Prisma. Bu doküman taslak şemadır; migration yazılmadan önce kesinleştirilecek.

## Multi-tenant

- `tenants` tablosu: id, name, slug (unique), plan, is_active, deleted_at.
- `tenants` dışındaki tüm iş tablolarında `tenant_id` zorunludur ve indekslidir.
- Tekil alanlar tenant içinde tekildir: örn. `(tenant_id, sku)`.
- Tenant'a ait tablolarda `(tenant_id, id)` tekildir. Tenant'a ait tablolar arası yabancı anahtarlar composite'tir: `(tenant_id, user_id)` → `users(tenant_id, id)`. Böylece farklı tenant'ın kaydına bağlantı veritabanında da imkânsızdır (migration `tenant_composite_fks`).

## Kurallar

- Tablo adları İngilizce, çoğul, `snake_case`: `products`, `order_items`.
- Birincil anahtar: `id` (UUID).
- Her tabloda `created_at`, `updated_at` bulunur.
- Silinebilir kayıtlarda `deleted_at` (soft delete).
- Yabancı anahtar adı: `<tablo_tekil>_id`.
- Para: `NUMERIC(12,2)` + `currency CHAR(3)`.

## Taslak Tablolar

### auth (kesinleşti — migration `init_tenants_auth`)
- `users` — id, tenant_id, name, email (global unique), password_hash, is_active, last_login_at, deleted_at
  - Bir kullanıcı tek bir tenant'a aittir. Email global tekil olduğu için giriş yalnızca email + şifre ile yapılır; tenant kullanıcıdan çözülür.
- `roles` — id, tenant_id, name, permissions (`text[]`, örn. `products:read`) — `(tenant_id, name)` tekil
- `user_roles` — tenant_id, user_id, role_id — birincil anahtar `(user_id, role_id)`
- `refresh_tokens` — id, tenant_id, user_id, token_hash (unique, SHA-256), expires_at, revoked_at, replaced_by_id
  - Rotation: kullanılan token `revoked_at` alır, yeni token `replaced_by_id` ile bağlanır. İptal edilmiş token tekrar kullanılırsa kullanıcının tüm token'ları iptal edilir.

### audit (kesinleşti — migration `audit_logs`)
- `audit_logs` — id, tenant_id, actor_user_id, action (`audit_action` enum), module, entity_type, entity_id, before (`jsonb`), after (`jsonb`), ip_address, user_agent, created_at
  - **İstisna:** `updated_at` yoktur; kayıt değiştirilemez. `BEFORE UPDATE OR DELETE` trigger'ı işlemi reddeder.
  - `actor_user_id` yabancı anahtar değildir: kullanıcı silinse de geçmiş korunur.
  - İndeksler: `(tenant_id, created_at)`, `(tenant_id, entity_type, entity_id)`, `(tenant_id, actor_user_id)`.
  - Saklama süresi / arşivleme ileride bir bakım işiyle yapılacaktır (trigger'ı yalnızca `app.allow_audit_purge = 'on'` oturum ayarı aşar).

### companies (taslak — geliştirilmedi)
- `companies` — id, tenant_id, legal_name, tax_number, tax_office, address fields, e_invoice_enabled, e_invoice_alias, deleted_at — `(tenant_id, tax_number)` tekil
- `user_company_roles` — tenant_id, user_id, company_id, role_id

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
- `channels` — id, company_id, type, name, credentials_ref, is_active
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
- Prisma şeması `database/prisma/schema.prisma`, migration'lar `database/prisma/migrations/` altındadır.
- Prisma migration'ları yalnızca ileri yönlüdür. Geri alma için her migration klasöründe `down.sql` tutulur.

## Roller

Uygulama `tm_app`, migration `tm_migrator` rolüyle çalışır; ayrıntılar [SECURITY.md](SECURITY.md#1-veritabanı-rolleri-en-az-yetki). Yeni append-only tablo eklenirse migration'da `REVOKE UPDATE, DELETE ON <tablo> FROM tm_app` yazılmalıdır.
