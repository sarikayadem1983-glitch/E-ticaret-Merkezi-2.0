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
- `invitations` — token yalnızca SHA-256 olarak; kısmi tekil `(tenant_id, email) WHERE status='pending'`. Silinmez (tm_app'te DELETE yok). `invitation_status` enum'u `pending`/`accepted`/`revoked`'tır; "süresi dolmuş" ayrı durum değildir, `status='pending' AND expires_at <= now()` ile türetilir (davet servisi için yeni migration gerekmedi). Süresi dolmuş bekleyen davet aynı e-postaya yeni daveti engeller; yeniden gönderme onu yeni token ve süreyle canlandırır. `company_roles` jsonb `[{ companyId, roleId }]`; kabulde firmalar ve roller yeniden okunur.
- Prisma şemasında gösterilemeyenler (yalnızca SQL'de): generated `role_scope` kolonları ve 3 kolonlu kapsam FK'leri, kısmi tekil indeksler, `invitations_email_lowercase` CHECK.
  - **Bu yüzden şema yalnızca `prisma migrate deploy` ile uygulanır.** `prisma migrate dev` / `db push` bu nesneleri drift sayıp silmeye çalışır: kullanılmaz. Bu nesneleri içeren migration'lar elle yazılır; varlıkları `migration-phase1.e2e-spec.ts` içindeki "SQL-only constraints exist after migration" testiyle denetlenir.
- Doğrulama/geri dönüş: `database/migrations-verify/20261029090000/` (`snapshot-before.sql`, `verify-after.sql`, `rollback.sql`). Test: `backend/test/migration-phase1.e2e-spec.ts` (atılabilir `tm_migration_test_*` veritabanında).
- Aşamalar:
  - **Aşama 1** (`20261029090000_tenant_memberships`): yalnızca ekleme; `users.tenant_id`/`is_active` korunur, `rollback.sql` ile geri alınabilir.
  - **Aşama 2** (hazır, uygulanmadı): `database/migrations-pending/phase2_drop_legacy_user_columns/migration.sql` — `users.tenant_id` kolonunu ve `_mig_snapshot_*` tablolarını siler; `users.is_active` korunur (`src/database/pending-migrations.spec.ts` denetler). `prisma/migrations/` dışında durur; kod `tenant_id` okumayı bıraktıktan ve Aşama 1 geliştirme veritabanında doğrulandıktan sonra taşınır. Sonrasında Aşama 1 `rollback.sql` çalışmaz, geri dönüş yalnızca yedekten.
- Yedek ve izole prova: `bash database/scripts/backup-and-rehearse.sh <out-dir>` (OPS-08: hedef veritabanının son uygulanan migration'ından sonraki **bekleyen** migration'ları bulur; bekleyen yoksa bunu raporlar ve çıkış 0 verir. Her bekleyen migration için: deploy, varsa klasördeki `verify.sql` satırları (`ad|t/f|ayrıntı`), eski tabloların satır sayıları, ikinci deploy no-op, `down.sql` ters sırayla şemayı birebir geri getirir mi, varsa `rehearsal-seed.sql` ile dolu veride `down.sql` durur mu. Aşama 1 kontrolleri yalnızca Aşama 1 bekliyorken çalışır. Kaynak DB yalnızca `pg_dump` ile okunur; yalnızca `tm_` önekli geçici DB oluşturulur ve silinir; rapor satır içeriği içermez.)
  - `<out-dir>` repo dışında olmalı (dump gerçek kullanıcı verisi içerir; `*.dump` git'e girmez).
  - Kaynak `.env`'deki `POSTGRES_DB`; ona yalnızca `pg_dump` ile okuma yapılır. Oluşturulan/silinen veritabanları `tm_` ile başlar, kaynakla aynı olamaz; yalnızca `tm-postgres` / localhost.
  - Adımlar: `pg_dump -Fc` → `pg_restore --list` → `tm_restore_check`'e geri yükleme ve tablo satır sayısı karşılaştırması → `tm_migration_rehearsal`'a geri yükleme → `snapshot-before.sql` → `prisma migrate deploy` (prisma'ya verilen URL'nin `current_database()`'i önce doğrulanır) → `verify-after.sql` + kullanıcı sayısı/id kümesi, üyelik eşleşmesi, owner ve rol atamaları, e-posta çakışmaları (yalnızca raporlanır) → ikinci `migrate deploy` no-op, `migration.sql`'in doğrudan tekrarı veri değiştirmeden hata verir → `rollback.sql` ayrı kopyada (`tm_rollback_rehearsal`) başarılı; ikinci üyelik eklenmiş kopyada (`tm_rollback_stop_rehearsal`) ve `tenant_id`siz kullanıcı eklenmiş kopyada (`tm_rollback_null_rehearsal`) veri değiştirmeden durur.
  - Çıktı: `<POSTGRES_DB>-<ts>.dump`, `restore-check.txt`, `rehearsal-verify.txt` (yalnızca sayılar ve kontrol adları). Prova veritabanları sonunda silinir. Çıkış 0 = tüm kontroller `ok=t`.

### catalog (CAT-01 yazıldı ve izole veritabanında denendi — migration `catalog_schema`; geliştirme veritabanına henüz uygulanmadı)
- Kapsam: kategori ve marka **tenant** genelidir (tüm firmalar paylaşır); ürün ve varyant bir **firmaya** aittir (`company_id` zorunlu). Firma bazlı yetki CAT-02'de `assertCompanyPermission(user, product.companyId, 'products:write')` ile uygulanır.
- `categories` — id, tenant_id, parent_id, name (150), slug (160), created_at, updated_at, deleted_at
  - Ağaç: `(tenant_id, parent_id)` → `categories(tenant_id, id)` (ON DELETE NO ACTION). `(tenant_id, slug)` yalnızca silinmemiş satırlar arasında tekil (kısmi indeks `categories_tenant_id_slug_active_key`): soft-delete edilen kategorinin slug'ı yeniden kullanılabilir.
  - CHECK `categories_no_self_parent` (kendi ebeveyni olamaz), `categories_slug_format` (`^[a-z0-9]+(-[a-z0-9]+)*$`; yalnızca küçük harf, bu yüzden slug tekilliği fiilen büyük/küçük harf duyarsız). Daha derin döngü kontrolü uygulamada (CAT-02).
- `brands` — id, tenant_id, name (150), created_at, updated_at, deleted_at
  - Ad tenant içinde büyük/küçük harf duyarsız ve yalnızca silinmemiş satırlar arasında tekil: kısmi ifade indeksi `brands_tenant_id_name_active_key` `(tenant_id, lower(btrim(name))) WHERE deleted_at IS NULL`. CHECK `brands_name_trimmed`: baş/son boşluk yok, boş değil.
- `products` — id, tenant_id, company_id, category_id?, brand_id?, name (250), description, status (`product_status`: `draft`|`active`|`archived`, varsayılan `draft`), created_at, updated_at, deleted_at
  - Composite FK'ler: `(tenant_id, company_id)` → `companies`, `(tenant_id, category_id)` → `categories`, `(tenant_id, brand_id)` → `brands` (hepsi RESTRICT).
  - Tekil `(tenant_id, company_id, id)`: varyant FK'sinin hedefi.
  - İndeksler: `(tenant_id, company_id, status)`, `(tenant_id, category_id)`, `(tenant_id, brand_id)`.
- `product_variants` — id, tenant_id, company_id, product_id, sku (100), barcode? (50), created_at, updated_at, deleted_at
  - FK `(tenant_id, company_id, product_id)` → `products(tenant_id, company_id, id)`: varyant başka tenant'ın ürününe ve ürününün firmasından başka firmaya bağlanamaz.
  - `(tenant_id, sku)` ve `(tenant_id, barcode)` tekil: tenant içinde, firmalar arası ve **soft-delete edilmiş satırlar dahil**. Karar: silinen varyantın SKU'su/barkodu **yeniden kullanılamaz**, çünkü sipariş, stok ve pazaryeri geçmişi onlara başvurur. Barkodsuz varyantlar çakışmaz (NULL).
  - SKU ve barkod büyük/küçük harf **duyarlıdır** (pazaryeri barkodları birebir karşılaştırılır). CHECK `product_variants_sku_not_blank`, `product_variants_barcode_not_blank`, `product_variants_sku_trimmed`, `product_variants_barcode_trimmed` (baş/son boşluk yok).
  - Tek varyantlı ürün de bir varyant satırı taşır (SKU her zaman varyanttadır); bu kural uygulamada (CAT-02).
- Fiyat, para birimi ve KDV oranı bu tablolarda **yoktur**: CAT-05 ayrı tabloda (`NUMERIC` + `currency`) varyanta `(tenant_id, id)` ile bağlanır. Özellik/eksen (renk, beden) CAT-03'te ayrı tablolarla eklenir; kanal kategori eşlemesi (CAT-06) `categories(tenant_id, id)`'ye bağlanır. Mevcut kolonlar değişmez.
- Silme yok: tüm katalog tabloları `deleted_at` ile soft-delete edilir; `tm_app`'te `DELETE`/`TRUNCATE` yok (`SELECT, INSERT, UPDATE`).
- CAT-02 uygulama kuralları (`backend/src/catalog`, API: `docs/API_DOCUMENTATION.md` Katalog): kategori döngüsü (A→B→A ve daha derin) `createsCycle` ile reddedilir (`422 CATEGORY_CYCLE`); ürün silinmiş veya olmayan kategori/markaya bağlanamaz (`422 CATEGORY_UNAVAILABLE` / `BRAND_UNAVAILABLE`); silinmemiş alt kategorisi veya ürünü olan kategori ve ürünü olan marka silinemez (`409 CATEGORY_IN_USE` / `BRAND_IN_USE`); ürünün son varyantı silinemez (`409 LAST_VARIANT`). Kontroller ve yazma aynı `SERIALIZABLE` transaction'da çalışır (çakışma `409 CONCURRENT_UPDATE`). Firma kapsamı repository filtresindedir (`company_id IN (...)`), çünkü tenant eklentisi yalnızca `tenant_id` ekler. Ürün silinince silinmemiş varyantları da soft-delete edilir. Ham SQL insert yoktur; `updated_at`'i Prisma (`@updatedAt`) yazar. İleride ham insert eklenirse `updated_at` açıkça verilmelidir (DB varsayılanı yok). Unique ihlalleri `409 SKU_TAKEN`, `BARCODE_TAKEN`, `CATEGORY_SLUG_TAKEN`, `BRAND_NAME_TAKEN` olarak döner. Migration gerekmedi.
- İzinler (`roles.catalog.ts`): `products:read` (Admin, Operasyon, Muhasebe, Görüntüleyici), `products:write` (Admin, Operasyon); Owner `*`. Migration, sistem rollerinin `roles.permissions` kopyasına da ekler.
- Prisma şemasında gösterilemeyenler (yalnızca SQL'de; `schema.prisma`'da karşılığı olan `@@unique` yoktur): kısmi tekil indeksler `brands_tenant_id_name_active_key`, `categories_tenant_id_slug_active_key` ve yukarıdaki CHECK'ler. `prisma migrate diff` (migrate edilmiş veritabanı → şema) bunları silmeye çalışmaz; yalnızca önceki migration'lardan bilinen `role_scope` farkını gösterir.
- Geri dönüş: `down.sql` (tek transaction; yalnızca sistem rollerinin (`key IS NOT NULL`) izinlerini geri alır; katalog tablolarında satır varsa hiçbir şey değiştirmeden durur; veri varsa geri dönüş yalnızca yedekten). Testler: `backend/test/catalog-schema.e2e-spec.ts` (izolasyon, composite FK, tekillik), `migration-catalog.e2e-spec.ts` (boş ve veri içeren veritabanında uygulama, ikinci uygulama, `down.sql`), `db-privileges.e2e-spec.ts` (yetkiler).

### catalog — varyant özellikleri (CAT-03; migration `catalog_variant_attributes`, izole e2e veritabanında denendi, geliştirme veritabanına henüz uygulanmadı)
- Özellikler (renk, beden…) **tenant** genelidir (marka gibi tüm firmalar paylaşır); değerleri varyanta bağlanır.
- `attributes` — id, tenant_id, name (100), created_at, updated_at, deleted_at
  - Ad tenant içinde büyük/küçük harf duyarsız, silinmemiş satırlar arasında tekil: kısmi ifade indeksi `attributes_tenant_id_name_active_key` `(tenant_id, lower(btrim(name))) WHERE deleted_at IS NULL`. CHECK `attributes_name_trimmed`.
- `attribute_values` — id, tenant_id, attribute_id, value (100), sort_order (int, varsayılan 0), created_at, updated_at, deleted_at
  - FK `(tenant_id, attribute_id)` → `attributes(tenant_id, id)`. Tekil `(tenant_id, attribute_id, id)`: bağlantı tablosunun FK hedefi (değer başka özelliğin değeri olarak bağlanamaz).
  - Değer özellik içinde büyük/küçük harf duyarsız, silinmemişler arasında tekil: `attribute_values_tenant_id_attribute_id_value_active_key` `(tenant_id, attribute_id, lower(btrim(value))) WHERE deleted_at IS NULL`. CHECK `attribute_values_value_trimmed`.
- `variant_attribute_values` — tenant_id, variant_id, attribute_id, attribute_value_id, created_at, updated_at — PK `(variant_id, attribute_id)`: bir varyantın her eksende **tek** değeri olur.
  - FK `(tenant_id, variant_id)` → `product_variants(tenant_id, id)`, `(tenant_id, attribute_id, attribute_value_id)` → `attribute_values(tenant_id, attribute_id, id)` (RESTRICT). İndeks `(tenant_id, attribute_value_id)` (kullanımda mı kontrolü).
  - Satır silinmez; değer değişikliği `UPDATE`'tir. Varyant soft-delete edilince bağlantı satırı geçmiş için kalır.
- Uygulama kuralları: aynı ürünün silinmemiş iki varyantı aynı özellik-değer kombinasyonunu taşıyamaz (`409 VARIANT_COMBINATION_TAKEN`, `SERIALIZABLE` transaction'da kontrol); silinmemiş bir varyantın kullandığı özellik/değer silinemez (`409 ATTRIBUTE_IN_USE` / `ATTRIBUTE_VALUE_IN_USE`). Varyant üretimi (`POST /products/:id/variants/generate`) eksen değerlerinin kartezyen çarpımını üretir (en çok 3 eksen, 100 kombinasyon); var olan kombinasyonlar atlanır.
- `tm_app`: üç tabloda da `SELECT, INSERT, UPDATE` (DELETE/TRUNCATE yok).
- Geri dönüş: `down.sql` (tablolarda satır varsa hiçbir şey değiştirmeden durur).

### catalog — fiyat ve KDV (CAT-05; migration `catalog_prices`, izole e2e veritabanında denendi, geliştirme veritabanına henüz uygulanmadı)
- `products.vat_rate` — `NUMERIC(5,2)` NULL (eklenen kolon; mevcut satırlarda NULL = "KDV oranı girilmedi"). CHECK `products_vat_rate_range` (0–100). Uygulama yalnızca yürürlükteki oranları kabul eder: `0`, `1`, `10`, `20` (oran değişirse yalnızca `pricing.ts` güncellenir, migration gerekmez).
- `variant_prices` — id, tenant_id, variant_id, channel (50), amount `NUMERIC(12,2)`, currency `CHAR(3)`, created_at, updated_at, deleted_at
  - FK `(tenant_id, variant_id)` → `product_variants(tenant_id, id)` (RESTRICT). Firma, varyantın ürününden gelir (ayrı kolon tutulmaz).
  - `channel`: `list` = **liste fiyatı**; diğer kodlar **kanal fiyatı** (ör. `trendyol`, `hepsiburada`). Kanal tablosu (INT-01) gelene kadar serbest kod: CHECK `variant_prices_channel_format` (`^[a-z0-9]+(-[a-z0-9]+)*$`). INT-01 kanalları bu kodlarla eşleştirir.
  - Varyant + kanal başına tek etkin fiyat: kısmi tekil `variant_prices_tenant_id_variant_id_channel_active_key` `(tenant_id, variant_id, channel) WHERE deleted_at IS NULL`. Fiyat silme soft-delete'tir; geçmiş satır ve Audit Log kalır.
  - CHECK `variant_prices_amount_non_negative` (`amount >= 0`), `variant_prices_currency_format` (`^[A-Z]{3}$`). Uygulama `TRY`, `USD`, `EUR` kabul eder.
  - İndeks `(tenant_id, variant_id)`.
  - `tm_app`: `SELECT, INSERT, UPDATE` (DELETE/TRUNCATE yok).
- **Para ve yuvarlama kuralı** (`backend/src/catalog/pricing.ts`):
  - Tutarlar API'de **ondalık metin**dir (`"199.90"`), JSON sayısı değildir; sunucuda `Prisma.Decimal` (decimal.js) ile hesaplanır, `float`/`number` kullanılmaz. Saklama `NUMERIC(12,2)`.
  - Girdi en çok 2 ondalık basamak taşır (`^(0|[1-9]\d{0,9})(\.\d{1,2})?$`); fazlası **reddedilir** (`422`), sessizce yuvarlanmaz. Ondalık ayırıcı noktadır; arayüz virgülü noktaya çevirir.
  - Fiyatlar **KDV dahil**dir (Türkiye pazaryeri kuralı). Net ve KDV, birim fiyat başına türetilir: `net = brüt / (1 + oran/100)`, **kuruşa (2 basamak) yarım-yukarı (ROUND_HALF_UP)** yuvarlanır; `kdv = brüt − net`. Böylece `net + kdv = brüt` her zaman tam eşittir. Örnek: 199,90 TL %20 → net 166,58, KDV 33,32.
  - Satır/sipariş toplamları (ileride ORD/INV) birim tutarlar toplanarak hesaplanır; toplamdan geriye KDV dağıtımı bu görevde yoktur.
  - Ürünün `vat_rate`'i yoksa net/KDV `null` döner.
- Geri dönüş: `down.sql` (`variant_prices`'ta satır veya `vat_rate` dolu ürün varsa hiçbir şey değiştirmeden durur).

### inventory (INV-01; migration `20261114150000_inventory_schema`, dev'e uygulandı 2026-11-14)
- **Kural: stok = hareketlerin toplamı.** Stok yalnızca `stock_movements`'a satır eklenerek değişir; `stock_levels.on_hand` bu toplamın veritabanı tetikleyicisiyle tutulan kopyasıdır.
- `warehouses` — id, tenant_id, company_id, name (100), is_default, is_active, created_at, updated_at
  - Firma içinde ad tekil (büyük/küçük harf duyarsız: `lower(name)`), firma başına en çok bir varsayılan depo (kısmi tekil). Silme yok; pasife alınır. `tm_app`: SELECT/INSERT/UPDATE.
- `stock_movements` — id, tenant_id, company_id, warehouse_id, variant_id, quantity (işaretli, ≠ 0), reason, reference_type, reference_id, created_by, created_at
  - **Append-only:** `tm_app` yalnızca SELECT/INSERT; Prisma tenant eklentisi de güncelleme/silmeyi reddeder. Ayrıca `stock_guard` tetikleyicisi **sahip rol dahil** UPDATE/DELETE/TRUNCATE'i reddeder (yalnızca test temizliği `SET LOCAL app.allow_stock_purge = 'on'` ile geçer; süper kullanıcının tetikleyici atlaması kapsam dışı). Düzeltme yeni bir `adjustment` hareketiyle yapılır.
  - `reason` ∈ `opening | adjustment | count | purchase | order | order_cancel | return | transfer_in | transfer_out`; yön CHECK'i: giriş nedenleri > 0, `order`/`transfer_out` < 0, `adjustment`/`count` iki yönlü.
  - `reference_type` ∈ `order | order_item | sync_job | transfer | manual`; `reference_id` yalnızca kayda işaret eden türlerde dolu (CHECK). Kısmi tekil `(tenant_id, reference_type, reference_id, warehouse_id, variant_id) WHERE reason = 'order'`: aynı sipariş satırı stoku iki kez düşüremez. İade, iptal ve transfer aynı referansla tekrarlanabilir (kısmi iade); fazlası uygulamada miktar toplamıyla denetlenir (INV-02/INT-TY-03).
  - `adjustment` ve `count` hareketlerinde `created_by` zorunlu (ya da `reference_type = 'sync_job'`).
  - FK `(tenant_id, company_id, warehouse_id)` → `warehouses` ve `(tenant_id, company_id, variant_id)` → `product_variants`: depo ve varyant hareketin firmasına ait olmak zorunda.
- `stock_levels` — id, tenant_id, company_id, warehouse_id, variant_id, on_hand, reserved, created_at, updated_at; tekil `(tenant_id, warehouse_id, variant_id)`
  - Tetikleyici `stock_movements_apply` (AFTER INSERT, `SECURITY DEFINER`, `search_path` sabit): önce `UPDATE … on_hand = on_hand + quantity` (satır kilidi; eşzamanlı düşümler sıraya girer), satır yoksa INSERT. CHECK `on_hand >= 0`: stoku eksiye düşürecek hareket tümüyle reddedilir (izole testte iki eşzamanlı −5 / 8 stok: biri reddedildi).
  - `tm_app`: yalnızca SELECT. `on_hand` ve yeni satır yalnızca tetikleyiciden gelir; `stock_guard` doğrudan `on_hand` değişikliğini ve satır silmeyi her rolde reddeder.
  - **INV-02 kararı:** `reserved` (≥ 0) yalnızca tenant kontrollü `SECURITY DEFINER` fonksiyonlarla (`reserve`/`release`) değişecek; doğrudan UPDATE yetkisi verilmeyecek. Kullanılabilir stok `on_hand − reserved`; `reserved <= on_hand` kuralı ve sipariş düşümünde önce rezervasyonun azaltılması INV-02'de.
- Geri dönüş: `down.sql` (üç tablodan birinde satır varsa hiçbir şey değiştirmeden durur; tetikleyicileri ve fonksiyonları da kaldırır). Prova dosyaları: `verify.sql` (yetki, tetikleyici, boş tablo kontrolleri) ve `rehearsal-seed.sql` (durma koşulu için test satırları), `backup-and-rehearse.sh` (OPS-08) tarafından kullanılır.

### channels
- `channels` — id, company_id, type, name, credentials_ref, is_active
- `channel_listings` — id, channel_id, variant_id, external_id, price, sync_status

### customers
- `customers` — id, name, email, phone
- `addresses` — id, customer_id, type, address fields

### orders (ORD-01; migration `20261114120000_orders_schema`, dev'e uygulandı 2026-11-14)
- `orders` — id, tenant_id, company_id, channel (50), channel_account_id (NULL = elle girilen sipariş), external_order_no (100, NULL), status (30), currency `CHAR(3)`, subtotal, discount_total (satıcı indirimi), channel_discount_total (pazaryeri indirimi, ör. Trendyol `totalTyDiscount`), shipping_total, total (`NUMERIC(12,2)`), ordered_at, created_at, updated_at
  - Silme yok: `deleted_at` yok, `tm_app` için DELETE yok. İptal/iade bir durumdur.
  - Pazaryeri sipariş no tenant + kanal içinde tekil: kısmi tekil `(tenant_id, channel, external_order_no) WHERE external_order_no IS NOT NULL`. Aynı sipariş iki kez içeri alınamaz (ek koruma: `channel_external_refs`).
  - FK `(tenant_id, company_id, channel, channel_account_id)` → `channel_accounts(tenant_id, company_id, channel, id)`: hesap siparişin firmasına ve kanalına ait olmak zorunda (bunun için `channel_accounts` üzerinde 4 kolonlu tekil indeks eklendi). Hesap varsa `external_order_no` zorunlu.
  - `status` ∈ `awaiting | created | picking | invoiced | unpacked | repack | shipped | at_collection_point | delivered | undelivered | cancelled | unsupplied | returned` (Trendyol paket durumlarının snake_case karşılığı). Geçiş kuralları ORD-02'de (uygulama katmanı).
  - Tekillik kararı: `(tenant_id, channel, external_order_no)`; aynı tenant'ta aynı kanalın iki hesabı olsa da Trendyol sipariş numaraları global tekil olduğundan çakışma beklenmez.
  - Para: tutarlar pazaryerinin bildirdiği gibi **olduğu gibi** saklanır, hepsi ≥ 0 (CHECK). Pazaryeri indirimi satırlara kuruş kuruş dağıtıp her alanı ayrı yuvarladığından toplamlar arasında eşitlik CHECK'i yoktur; tutarsızlık ORD-02/INT-TY-03'te uzlaştırılıp işaretlenir. `channel` biçimi `variant_prices.channel` ile aynı.
  - **Müşteri kişisel verisi (ad, adres, telefon) burada tutulmaz**; CRM-01 KVKK maskelemesiyle ekler.
- `order_items` — id, tenant_id, company_id, order_id, variant_id (NULL = yerel varyantla eşleşmeyen pazaryeri satırı), external_line_id (100, NULL), sku (100), name (300), quantity, unit_price, discount, vat_rate `NUMERIC(5,2)` NULL, line_total, created_at, updated_at
  - sku/name sipariş anının kopyasıdır; katalog değişikliği geçmiş siparişi değiştirmez.
  - CHECK `quantity > 0`, tutarlar ≥ 0, KDV 0–100. `line_total` pazaryerinin bildirdiği tutardır (yuvarlama nedeniyle `quantity × unit_price − discount`'a eşit olmak zorunda değil).
  - Kısmi tekil `(tenant_id, order_id, external_line_id) WHERE external_line_id IS NOT NULL`.
  - FK `(tenant_id, company_id, order_id)` → `orders(tenant_id, company_id, id)` ve `(tenant_id, company_id, variant_id)` → `product_variants(tenant_id, company_id, id)`: satır, siparişin firmasına ait olmayan varyanta bağlanamaz (iki tarafa `(tenant_id, company_id, id)` tekil indeksi eklendi).
- `order_status_history` — id, tenant_id, order_id, from_status (NULL = ilk kayıt), to_status, source (`channel | user | system`), changed_by (source = `user` ise zorunlu; FK yok, `audit_logs` gibi kullanıcı silinse de iz kalır), sync_job_id (FK `(tenant_id, sync_job_id)` → `sync_jobs`), changed_at
  - **Append-only:** `tm_app` yalnızca SELECT/INSERT; Prisma tenant eklentisi de güncelleme/silmeyi reddeder (`APPEND_ONLY_MODELS`).
- `tm_app`: `orders`, `order_items` için SELECT/INSERT/UPDATE.
- Geri dönüş: `down.sql` (üç tablodan birinde satır varsa hiçbir şey değiştirmeden durur).

## Notlar

- Pazaryeri kimlik bilgileri veritabanında düz metin tutulmaz; şifreli saklanır veya gizli bilgi yöneticisinde referanslanır.
- Prisma şeması `database/prisma/schema.prisma`, migration'lar `database/prisma/migrations/` altındadır.
- Prisma migration'ları yalnızca ileri yönlüdür. Geri alma için her migration klasöründe `down.sql` tutulur.

## Roller

Uygulama `tm_app`, migration `tm_migrator` rolüyle çalışır; ayrıntılar [SECURITY.md](SECURITY.md#1-veritabanı-rolleri-en-az-yetki). Yeni append-only tablo eklenirse migration'da `REVOKE UPDATE, DELETE ON <tablo> FROM tm_app` yazılmalıdır.

### Kanal kategori eşleme (CAT-06)

- `channel_categories`: kanalın kategori ağacı (tenant + kanal başına, `external_id` tekil). İçe aktarma tüm ağacı gönderir; listede olmayan düğümler soft-delete edilir.
- `channel_category_attributes`: kategorinin istediği özellikler (`required`, `varies_by_variant`, `allow_custom`, `allowed_values` JSON dizi).
- `category_channel_mappings`: bizim kategori → yaprak kanal kategorisi (kategori + kanal başına bir).
- `attribute_channel_mappings`: bizim varyant özelliği (CAT-03) → varyanta göre değişen kanal özelliği. Değer eşlemesi INT-TY-01'de.
- `product_channel_attribute_values`: ürün düzeyindeki kanal özelliği değeri (izinli değer `value_external_id` ile veya serbest değer).
- Hazırlık kontrolü `GET /products/:id/channel-readiness/:channel`: eksik kategori, eşleme, zorunlu değer ve değeri olmayan varyantları listeler.
- `tm_app`: ağaç tablolarında SELECT/INSERT/UPDATE; eşleme ve değer tablolarında DELETE de var (kullanıcı eşlemeyi kaldırabilir).

### Senkron motoru (INT-02)

Migration `20261113120000_sync_engine`. İzole test veritabanında denendi; dev veritabanına uygulanması kullanıcı onayı bekliyor.

- `sync_jobs`: her pazaryeri senkron işi için bir satır (durum + log). `status` ∈ `queued | running | succeeded | failed`; `error_code` yalnızca kod (serbest metin yok, CHECK ile); `payload` kimlik bilgisi taşımaz. Tekil: `(tenant_id, channel_account_id, kind, idempotency_key)`. `run_token`: satırın sahibi olan kuyruk işinin kimliği; satırı yalnızca o iş çalıştırabilir veya kapatabilir. `(tenant_id, company_id, channel_account_id)` → `channel_accounts` bileşik FK'sı, işin firmasının hesabın firmasıyla aynı olmasını zorlar (bunun için `channel_accounts` üzerinde `(tenant_id, company_id, id)` tekil indeksi eklendi).
- `channel_external_refs`: pazaryeri kaydı → yerel kayıt. Tekil: `(tenant_id, channel_account_id, entity_type, external_id)`; aynı sipariş iki kez içeri alınamaz. `entity_type` ∈ `order | product | variant`; `payload_hash` sha256 hex. Eski sürüm (`external_updated_at` daha eski) yenisinin üzerine yazmaz.
- `tm_app`: iki tabloda SELECT/INSERT/UPDATE; DELETE yok.
- `down.sql` tablolarda veri varken durur.
