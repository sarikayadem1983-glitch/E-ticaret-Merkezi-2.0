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

### companies (kesinleşti — migration `companies`)
- `companies` — id, tenant_id, legal_name, tax_number, tax_office, address_line, district, city, postal_code, country (varsayılan `TR`), phone, email, e_invoice_enabled, e_invoice_alias, is_active, created_at, updated_at
  - `(tenant_id, tax_number)` tekil. `tax_number` CHECK: 10 (VKN) veya 11 (TCKN) rakam; kontrol haneleri uygulamada doğrulanır.
  - Silme yok: firma `is_active = false` ile pasife alınır (ileride fatura/sipariş kayıtları firmaya bağlı kalır). Taslaktaki `deleted_at` bu yüzden kullanılmadı.
  - İndeks: `(tenant_id, is_active, legal_name)` (liste ve filtre).
- `user_company_roles` — tenant_id, user_id, company_id, role_id, created_at — PK `(user_id, company_id, role_id)`
  - Composite FK'ler: `(tenant_id, user_id)`, `(tenant_id, company_id)`, `(tenant_id, role_id)`; farklı tenant'ın kaydına bağlanamaz.

### memberships (Aşama 1 yazıldı ve izole kopyada prova edildi — migration `tenant_memberships`; geliştirme veritabanına henüz uygulanmadı)
- Tasarım: [kullanıcı yönetimi spec'i](superpowers/specs/2026-10-28-user-management-design.md).
- `users` global kimlik olur: `last_tenant_id`, `email_verified_at` eklenir; e-posta küçük harfe normalize. `tenant_id` nullable, FK'si kaldırıldı; `tenant_id` Aşama 2'de silinir, kod okumaz. `is_active` kalır: login, refresh ve `JwtAuthGuard` pasif global kullanıcıyı onunla reddeder.
- `tenant_memberships` — tenant_id, user_id, status (`active`|`inactive`), auth_version, joined_at, deactivated_at — PK `(tenant_id, user_id)`. Silinmez (tm_app'te DELETE yok).
- `roles` + `key`, `scope` (`tenant`|`company`), `is_system`; kısmi tekil `(tenant_id, key) WHERE key IS NOT NULL`, tekil `(tenant_id, id, scope)`. Her tenant'ta 5 sistem rolü.
- `user_roles`/`user_company_roles`: `role_scope` generated kolon + FK `(tenant_id, role_id, role_scope) → roles(tenant_id, id, scope)`; FK `(tenant_id, user_id) → tenant_memberships`. `refresh_tokens` da üyeliğe bağlı. `user_company_roles` tekil `(tenant_id, user_id, company_id)`.
- `invitations` — token yalnızca SHA-256 olarak; kısmi tekil `(tenant_id, email) WHERE status='pending'`. Silinmez (tm_app'te DELETE yok).
- Prisma şemasında gösterilemeyenler (yalnızca SQL'de): generated `role_scope` kolonları ve 3 kolonlu kapsam FK'leri, kısmi tekil indeksler, `invitations_email_lowercase` CHECK.
  - **Bu yüzden şema yalnızca `prisma migrate deploy` ile uygulanır.** `prisma migrate dev` / `db push` bu nesneleri drift sayıp silmeye çalışır: kullanılmaz. Bu nesneleri içeren migration'lar elle yazılır; varlıkları `migration-phase1.e2e-spec.ts` içindeki "SQL-only constraints exist after migration" testiyle denetlenir.
- Doğrulama/geri dönüş: `database/migrations-verify/20261029090000/` (`snapshot-before.sql`, `verify-after.sql`, `rollback.sql`). Test: `backend/test/migration-phase1.e2e-spec.ts` (atılabilir `tm_migration_test_*` veritabanında).
- Aşamalar:
  - **Aşama 1** (`20261029090000_tenant_memberships`): yalnızca ekleme; `users.tenant_id`/`is_active` korunur, `rollback.sql` ile geri alınabilir.
  - **Aşama 2** (hazır, uygulanmadı): `database/migrations-pending/phase2_drop_legacy_user_columns/migration.sql` — `users.tenant_id` kolonunu ve `_mig_snapshot_*` tablolarını siler; `users.is_active` korunur (`src/database/pending-migrations.spec.ts` denetler). `prisma/migrations/` dışında durur; kod `tenant_id` okumayı bıraktıktan ve Aşama 1 geliştirme veritabanında doğrulandıktan sonra taşınır. Sonrasında Aşama 1 `rollback.sql` çalışmaz, geri dönüş yalnızca yedekten.
- Yedek ve izole prova: `bash database/scripts/backup-and-rehearse.sh <out-dir>`
  - `<out-dir>` repo dışında olmalı (dump gerçek kullanıcı verisi içerir; `*.dump` git'e girmez).
  - Kaynak `.env`'deki `POSTGRES_DB`; ona yalnızca `pg_dump` ile okuma yapılır. Oluşturulan/silinen veritabanları `tm_` ile başlar, kaynakla aynı olamaz; yalnızca `tm-postgres` / localhost.
  - Adımlar: `pg_dump -Fc` → `pg_restore --list` → `tm_restore_check`'e geri yükleme ve tablo satır sayısı karşılaştırması → `tm_migration_rehearsal`'a geri yükleme → `snapshot-before.sql` → `prisma migrate deploy` (prisma'ya verilen URL'nin `current_database()`'i önce doğrulanır) → `verify-after.sql` + kullanıcı sayısı/id kümesi, üyelik eşleşmesi, owner ve rol atamaları, e-posta çakışmaları (yalnızca raporlanır) → ikinci `migrate deploy` no-op, `migration.sql`'in doğrudan tekrarı veri değiştirmeden hata verir → `rollback.sql` ayrı kopyada (`tm_rollback_rehearsal`) başarılı; ikinci üyelik eklenmiş kopyada (`tm_rollback_stop_rehearsal`) ve `tenant_id`siz kullanıcı eklenmiş kopyada (`tm_rollback_null_rehearsal`) veri değiştirmeden durur.
  - Çıktı: `<POSTGRES_DB>-<ts>.dump`, `restore-check.txt`, `rehearsal-verify.txt` (yalnızca sayılar ve kontrol adları). Prova veritabanları sonunda silinir. Çıkış 0 = tüm kontroller `ok=t`.

### catalog (CAT-01 yazıldı ve izole veritabanında denendi — migration `catalog_schema`; geliştirme veritabanına henüz uygulanmadı)
- Kapsam: kategori ve marka **tenant** genelidir (tüm firmalar paylaşır); ürün ve varyant bir **firmaya** aittir (`company_id` zorunlu). Firma bazlı yetki CAT-02'de `assertCompanyPermission(user, product.companyId, 'products:write')` ile uygulanır.
- `categories` — id, tenant_id, parent_id, name (150), slug (160), created_at, updated_at, deleted_at
  - Ağaç: `(tenant_id, parent_id)` → `categories(tenant_id, id)` (ON DELETE NO ACTION). `(tenant_id, slug)` tekil.
  - CHECK `categories_no_self_parent` (kendi ebeveyni olamaz), `categories_slug_format` (`^[a-z0-9]+(-[a-z0-9]+)*$`). Daha derin döngü kontrolü uygulamada (CAT-02).
- `brands` — id, tenant_id, name (150), created_at, updated_at, deleted_at — `(tenant_id, name)` tekil (büyük/küçük harf duyarlı; normalizasyon uygulamada).
- `products` — id, tenant_id, company_id, category_id?, brand_id?, name (250), description, status (`product_status`: `draft`|`active`|`archived`, varsayılan `draft`), created_at, updated_at, deleted_at
  - Composite FK'ler: `(tenant_id, company_id)` → `companies`, `(tenant_id, category_id)` → `categories`, `(tenant_id, brand_id)` → `brands` (hepsi RESTRICT).
  - Tekil `(tenant_id, company_id, id)`: varyant FK'sinin hedefi.
  - İndeksler: `(tenant_id, company_id, status)`, `(tenant_id, category_id)`, `(tenant_id, brand_id)`.
- `product_variants` — id, tenant_id, company_id, product_id, sku (100), barcode? (50), created_at, updated_at, deleted_at
  - FK `(tenant_id, company_id, product_id)` → `products(tenant_id, company_id, id)`: varyant başka tenant'ın ürününe ve ürününün firmasından başka firmaya bağlanamaz.
  - `(tenant_id, sku)` ve `(tenant_id, barcode)` tekil: tenant içinde, firmalar arası ve **soft-delete edilmiş satırlar dahil**. Barkodsuz varyantlar çakışmaz (NULL). CHECK `product_variants_sku_not_blank`, `product_variants_barcode_not_blank`.
  - Tek varyantlı ürün de bir varyant satırı taşır (SKU her zaman varyanttadır); bu kural uygulamada (CAT-02).
- Fiyat, para birimi ve KDV oranı bu tablolarda **yoktur**: CAT-05 ayrı tabloda (`NUMERIC` + `currency`) varyanta `(tenant_id, id)` ile bağlanır. Özellik/eksen (renk, beden) CAT-03'te ayrı tablolarla eklenir; kanal kategori eşlemesi (CAT-06) `categories(tenant_id, id)`'ye bağlanır. Mevcut kolonlar değişmez.
- Silme yok: tüm katalog tabloları `deleted_at` ile soft-delete edilir; `tm_app`'te `DELETE`/`TRUNCATE` yok (`SELECT, INSERT, UPDATE`).
- İzinler (`roles.catalog.ts`): `products:read` (Admin, Operasyon, Muhasebe, Görüntüleyici), `products:write` (Admin, Operasyon); Owner `*`. Migration, sistem rollerinin `roles.permissions` kopyasına da ekler.
- Geri dönüş: `down.sql` (katalog tablolarında satır varsa hiçbir şey değiştirmeden durur; veri varsa geri dönüş yalnızca yedekten). Testler: `backend/test/catalog-schema.e2e-spec.ts` (izolasyon, composite FK, tekillik), `migration-catalog.e2e-spec.ts` (boş ve veri içeren veritabanında uygulama, ikinci uygulama, `down.sql`), `db-privileges.e2e-spec.ts` (yetkiler).

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
