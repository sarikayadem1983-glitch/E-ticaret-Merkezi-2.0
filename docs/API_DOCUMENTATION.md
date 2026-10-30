# API Dokümantasyonu

> Bu doküman API standartlarını tanımlar; endpoint'ler geliştirildikçe eklenir.

## Temel

- Taban yol: `/api/v1`
- Biçim: JSON, UTF-8
- Kimlik doğrulama: `Authorization: Bearer <token>`

## Yanıt Biçimi

Başarılı:

```json
{
  "data": {},
  "meta": {}
}
```

Hata:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Açıklama",
    "details": []
  }
}
```

## HTTP Durum Kodları

| Kod | Anlam |
|---|---|
| 200 | Başarılı |
| 201 | Oluşturuldu |
| 204 | İçerik yok |
| 400 | Geçersiz istek |
| 401 | Kimlik doğrulanmadı |
| 403 | Yetki yok |
| 404 | Bulunamadı |
| 409 | Çakışma (tekil alan, kullanımda olan kayıt, eşzamanlı değişiklik) |
| 422 | Doğrulama hatası |
| 500 | Sunucu hatası |

## Sayfalama

Sorgu: `?page=1&per_page=20`

```json
"meta": { "page": 1, "per_page": 20, "total": 135 }
```

## Planlanan Endpoint Grupları

| Grup | Yol |
|---|---|
| Kimlik | `/api/v1/auth` |
| Ürünler | `/api/v1/products` |
| Stok | `/api/v1/inventory` |
| Siparişler | `/api/v1/orders` |
| Kanallar | `/api/v1/channels` |
| Müşteriler | `/api/v1/customers` |
| Raporlar | `/api/v1/reports` |

## Endpoint Şablonu

```
### METHOD /api/v1/<yol>
Açıklama:
Yetki:
İstek:
Yanıt:
Hatalar:
```

## Endpoint'ler

### GET /api/v1/health
Açıklama: Uygulamanın, veritabanı bağlantısının ve kuyruk Redis'inin durumunu döner.
Yetki: Yok (herkese açık)
İstek: —
Yanıt: `200` `{ "data": { "status": "ok", "database": "up", "queue": "up" } }`. `queue` Redis'e ulaşılamıyorsa `"down"` olur; bu durumda yanıt yine `200`'dür (API çalışmaya devam eder, arka plan işleri bekler). İzleme `queue: "down"` için ayrıca alarm vermelidir.
Hatalar: `503` veritabanına ulaşılamıyor

### POST /api/v1/auth/register
Açıklama: Yeni tenant (mağaza) ve sahibini oluşturur. Sahibe `owner` rolü (`*` izni) verilir.
Yetki: Yok (herkese açık)
İstek: `{ "tenantName": "Örnek Mağaza", "tenantSlug": "ornek-magaza", "name": "Ad Soyad", "email": "a@b.com", "password": "en az 8 karakter" }`
Yanıt: `201` `{ "data": { "accessToken": "...", "refreshToken": "...", "expiresIn": 900 } }`
Hatalar: `409` email veya slug kullanımda, `422` doğrulama hatası, `429` `TOO_MANY_REQUESTS` (+ `Retry-After`), `503` hız sınırı servisi erişilemiyor (bkz. SECURITY.md §3)

### POST /api/v1/auth/login
Açıklama: Email + şifre ile giriş.
Yetki: Yok (herkese açık)
İstek: `{ "email": "a@b.com", "password": "..." }`
Yanıt: `200` register ile aynı
Hatalar: `401` `INVALID_CREDENTIALS` (kullanıcı yok, şifre yanlış, kullanıcı pasif veya silinmiş, üyelik veya tenant pasif — gövde birebir aynı, ayrım yapılmaz), `422`, `429` `TOO_MANY_REQUESTS` (+ `Retry-After`), `503` hız sınırı servisi erişilemiyor (bkz. SECURITY.md §3)

### POST /api/v1/auth/refresh
Açıklama: Refresh token'ı döndürür (rotation). Eski token geçersiz olur.
Yetki: Yok (refresh token gövdede)
İstek: `{ "refreshToken": "..." }`
Yanıt: `200` register ile aynı
Hatalar: `401` `INVALID_REFRESH_TOKEN` (yok, süresi dolmuş, iptal edilmiş — iptal edilmiş token kullanılırsa kullanıcının tüm mağazalardaki refresh token'ları iptal edilir ve açık access token'ları hemen `TOKEN_STALE` olur, etkilenen her mağazaya `TOKEN_REUSE_DETECTED` audit kaydı yazılır; kullanıcı pasif veya silinmişse gönderilen token iptal edilir, aynı gövde döner ve tekrar kullanım alarmı tetiklenmez), `422`, `429` `TOO_MANY_REQUESTS` (+ `Retry-After`), `500` tekrar kullanımda oturumlar iptal edilemezse (token üretilmez), `503` hız sınırı servisi erişilemiyor (bkz. SECURITY.md §3)

### POST /api/v1/auth/logout
Açıklama: Verilen refresh token'ı iptal eder.
Yetki: Bearer token
İstek: `{ "refreshToken": "..." }`
Yanıt: `204`
Hatalar: `401`, `422`

### GET /api/v1/auth/me
Açıklama: Oturumdaki kullanıcı.
Yetki: Bearer token
Yanıt: `200` `{ "data": { "id": "...", "tenantId": "...", "name": "...", "email": "...", "tenant": { "id": "...", "name": "...", "slug": "..." }, "permissions": ["*"] } }`
Hatalar: `401`

### GET /api/v1/auth/memberships
Açıklama: Kullanıcının aktif üyeliği olan aktif mağazaları (mağaza adına göre sıralı). `current`, token'ın ait olduğu mağazadır. Pasif üyelik ve pasif mağaza listelenmez.
Yetki: Bearer token (izin gerekmez)
Yanıt: `200` `{ "data": [ { "tenantId": "...", "name": "...", "slug": "...", "current": true } ] }`
Hatalar: `401`
BFF: `GET /api/bff/auth/memberships`

### POST /api/v1/auth/switch-tenant
Açıklama: Oturumu başka bir mağazaya taşır. Gönderilen refresh token çağıranın, mevcut mağazadaki aktif token'ı olmalıdır; iptal edilir ve hedef üyelik için yeni token çifti üretilir. `tid`, `perms`, `ver` yalnızca hedef üyelikten hesaplanır. `last_tenant_id` hedef mağaza olur. Eski mağazadaki üyeliğin `auth_version`'ı artırılır: eski mağazanın access token'ı sonraki istekte `401 TOKEN_STALE` alır. Her iki mağazaya `TENANT_SWITCH` audit kaydı yazılır (`after: { fromTenantId, toTenantId }`, token içermez).
Yetki: Bearer token
İstek: `{ "tenantId": "<uuid>", "refreshToken": "..." }`
Yanıt: `200` register ile aynı (`TokenPair`)
Hatalar: `401` `INVALID_REFRESH_TOKEN` (token yok, iptal edilmiş, süresi dolmuş, başka kullanıcının/mağazanın), `404` `TENANT_NOT_FOUND` (hedefte aktif üyelik yok, üyelik pasif, mağaza pasif veya yok — ayrım yapılmaz; token üretilmez, mevcut oturum geçerli kalır; üyelik satırı işlem içinde `FOR SHARE` ile yeniden okunur, eş zamanlı pasife alma da `404` verir), `422` (geçersiz gövde veya hedef zaten mevcut mağaza; token döndürülmez, audit yazılmaz)

### POST /api/v1/auth/switch-tenant/abort
Açıklama: Yalnızca BFF kullanır. `switch-tenant` başarılı olduktan sonra BFF yeni oturumu saklayamazsa (ör. Redis hatası) değişikliği geri alır, böylece eski oturum çalışmaya devam eder ve tekrar kullanım alarmı (`TOKEN_REUSE_DETECTED`) tetiklenmez (INF-18). Tek transaction'da: yeni (hedef mağaza) refresh token halefsiz iptal edilir, eski token'ın iptali ve `replaced_by_id`'si temizlenir. `last_tenant_id` eski mağazaya döner. Eski mağazadaki `auth_version` artışı geri alınmaz: eski access token bir kez `TOKEN_STALE` alır, eski refresh token ile yenilenir. Her iki mağazaya `TENANT_SWITCH` audit kaydı yazılır (`after: { fromTenantId, toTenantId, aborted: true }`).
Koşullar (hepsi): iki token da var ve aynı kullanıcının; eski token'ın halefi tam olarak yeni token; yeni token hiç kullanılmamış (iptal edilmemiş, halefi yok) ve en fazla 60 sn önce üretilmiş; iki token'ın da süresi dolmamış.
Yetki: Yok (`@Public`). İki refresh token'a birden sahip olmak gerekir. Redis kullanmaz ve rate limit uygulanmaz: geri alma tam Redis kesintisinde gerekir; token'lar 384 bit rastgeledir.
İstek: `{ "refreshToken": "<yeni>", "previousRefreshToken": "<eski>" }`
Yanıt: `204`
Hatalar: `401` `INVALID_REFRESH_TOKEN` (koşullardan biri sağlanmıyor; hiçbir şey değişmez, tekrar kullanım alarmı verilmez), `422` (geçersiz gövde)

### BFF: POST /api/session/tenant
Açıklama: Tarayıcının mağaza değiştirme çağrısı. CSRF kontrolü (§5 SECURITY.md) uygulanır. Backend `switch-tenant` başarılıysa yeni token'lar her zaman yeni oturum kimliğiyle saklanır (kimlik `auth/me`'den, o başarısızsa access token'ın `sub`/`tid` claim'lerinden), eski oturum kimliği silinir (eski refresh token backend'de iptal edildiği için asla kullanımda kalmaz; silme başarısız olursa kayıt TTL ile düşer), yeni oturum kimliği cookie olarak verilir, seçili firma sıfırlanır; mutlak oturum süresi ilk girişten saymaya devam eder.
İstek: `{ "tenantId": "<uuid>" }`
Yanıt: `204` (gövde yok, token dönmez)
Hatalar: `401` (oturum yok; veya yeni oturum kurulamadı — eski oturum silinir), `403` (CSRF), `404` (backend'den aynen; oturum değişmez), `415`, `422`, `503` (aynı oturumda token yenileme sürüyor, `Retry-After: 1`; veya oturum deposu (Redis) hatası. Hata backend değişikliğinden sonra yeni oturum yazılmadan olursa BFF `switch-tenant/abort` ile değişikliği geri alır: eski oturum ve cookie aynen kalır, tekrar kullanım alarmı oluşmaz; geri alma da başarısızsa cookie silinir ve kullanıcı yeniden giriş yapar)

### GET /api/v1/companies
Açıklama: Firmalar, unvana göre sıralı. `companies:all` izni olmayan kullanıcı yalnızca atandığı firmaları görür.
Yetki: Bearer token + `companies:read`
İstek (sorgu): `page` (varsayılan 1), `per_page` (varsayılan 20, en çok 100), `search` (unvan içinde veya vergi numarası başında), `status` (`active` | `inactive` | `all`, varsayılan `all`)
Yanıt: `200` `{ "data": [Company], "meta": { "page": 1, "per_page": 20, "total": 3 } }`
Hatalar: `401`, `403`, `422`

`Company`: `{ "id", "legalName", "taxNumber", "taxOffice", "addressLine", "district", "city", "postalCode", "country", "phone", "email", "eInvoiceEnabled", "eInvoiceAlias", "isActive", "createdAt", "updatedAt" }`

### GET /api/v1/companies/summary
Açıklama: Erişilebilen firma sayıları (dashboard).
Yetki: Bearer token + `companies:read`
Yanıt: `200` `{ "data": { "total": 3, "active": 2, "inactive": 1 } }`

### GET /api/v1/companies/:id
Yetki: Bearer token + `companies:read`
Yanıt: `200` `{ "data": Company }`
Hatalar: `404` firma yok, başka tenant'a ait veya kullanıcının erişimi yok (ayrım yapılmaz)

### POST /api/v1/companies
Açıklama: Firma oluşturur. Audit Log'a `CREATE` yazılır.
Yetki: Bearer token + `companies:write` + `companies:all`
İstek: `{ "legalName", "taxNumber", "taxOffice", "addressLine", "district", "city", "postalCode"?, "phone"?, "email"?, "eInvoiceEnabled"?, "eInvoiceAlias"? }`. `taxNumber`: kontrol hanesi doğru 10 haneli VKN veya 11 haneli TCKN. Boş metin `null` sayılır.
Yanıt: `201` `{ "data": Company }`
Hatalar: `409` `CONFLICT` vergi numarası bu tenant'ta kayıtlı, `422`

### PATCH /api/v1/companies/:id
Açıklama: Firmayı günceller (yalnızca gönderilen alanlar). Vergi numarası değiştirilemez. Audit Log'a değişen alanlarla `UPDATE` yazılır.
Yetki: Bearer token + `companies:write`
Yanıt: `200` `{ "data": Company }`
Hatalar: `404`, `422`

### POST /api/v1/companies/:id/deactivate · POST /api/v1/companies/:id/activate
Açıklama: Firmayı pasife alır / yeniden aktifleştirir. Firma silinmez. Audit Log'a `UPDATE` (`isActive`) yazılır.
Yetki: Bearer token + `companies:write`
Yanıt: `200` `{ "data": Company }`
Hatalar: `404`

### Katalog (CAT-02)
Kategori ve marka tenant geneli, ürün ve varyant bir firmaya aittir. Silme her zaman soft-delete'tir (`deleted_at`); silinen kayıt listelenmez ve `404` döner. Tüm yazmalar Audit Log'a `module: "catalog"` ile yazılır (`entityType`: `Category`, `Brand`, `Product`, `ProductVariant`; `CREATE` / `UPDATE` (değişen alanlar) / `DELETE`). Yazmalar `SERIALIZABLE` transaction'da çalışır; eşzamanlı çakışan bir yazma `409 CONCURRENT_UPDATE` alır, istemci tekrar dener.

Yetki kararı: kategori ve marka **okuma** `products:read` (Owner, Admin, Operasyon, Muhasebe, Görüntüleyici). **Yazma** `products:write` + `companies:all` (yalnızca mağaza rolü: Owner, Admin), çünkü tüm firmalar bu listeyi paylaşır; firma rolü (Operasyon) kategori/marka değiştiremez (`403`). Bu izin servis tarafında veritabanından da yeniden okunur. Ürün işlemlerinde guard JWT'deki modül iznini (`products:read` / `products:write`) kontrol eder; servis kullanıcının **ürünün firmasındaki** rolünü veritabanından okur: rol yoksa `404` (ürünün varlığı açığa çıkmaz), rol iznin dışındaysa `403`. `companies:all` olan mağaza rolü tüm firmaların ürünlerini görür; diğerleri yalnızca `products:read` veren rolün olduğu firmaları.

`Category`: `{ "id", "parentId", "name", "slug", "createdAt", "updatedAt" }`
`Brand`: `{ "id", "name", "createdAt", "updatedAt" }`
`Variant`: `{ "id", "productId", "sku", "barcode", "createdAt", "updatedAt" }`
`Product`: `{ "id", "companyId", "categoryId", "brandId", "name", "description", "status" ("draft" | "active" | "archived"), "createdAt", "updatedAt", "variants": [Variant] }` (yalnızca silinmemiş varyantlar, oluşturulma sırasına göre)

### GET /api/v1/categories · GET /api/v1/brands
Açıklama: Silinmemiş kategoriler / markalar, ada göre sıralı.
Yetki: Bearer token + `products:read`
İstek (sorgu): `page` (varsayılan 1), `per_page` (varsayılan 20, en çok 100), `search` (kategori: ad içinde veya slug başında; marka: ad içinde, büyük/küçük harf duyarsız)
Yanıt: `200` `{ "data": [Category | Brand], "meta": { "page", "per_page", "total" } }`
Hatalar: `401`, `403`, `422`

### GET /api/v1/categories/:id · GET /api/v1/brands/:id
Yetki: Bearer token + `products:read`
Yanıt: `200` `{ "data": Category | Brand }`
Hatalar: `404` yok, silinmiş veya başka tenant'a ait (ayrım yapılmaz)

### POST /api/v1/categories
Açıklama: Kategori oluşturur. Audit `CREATE`.
Yetki: Bearer token + `products:write` + `companies:all`
İstek: `{ "name" (1–150), "slug" (en çok 160, `^[a-z0-9]+(-[a-z0-9]+)*$`), "parentId"? (UUID veya `null` = kök) }`
Yanıt: `201` `{ "data": Category }`
Hatalar: `403`, `409 CATEGORY_SLUG_TAKEN` (slug silinmemiş bir kategoride kullanılıyor; silinen kategorinin slug'ı yeniden kullanılabilir), `422 CATEGORY_UNAVAILABLE` (üst kategori yok veya silinmiş), `422`

### PATCH /api/v1/categories/:id
Açıklama: Ad, slug veya üst kategoriyi değiştirir (yalnızca gönderilen alanlar; `parentId: null` köke taşır). Audit `UPDATE`.
Yetki: Bearer token + `products:write` + `companies:all`
Yanıt: `200` `{ "data": Category }`
Hatalar: `403`, `404`, `409 CATEGORY_SLUG_TAKEN`, `422 CATEGORY_CYCLE` (kategori kendisinin veya bir alt kategorisinin altına taşınamaz; A→B→A dahil), `422 CATEGORY_UNAVAILABLE`, `422`

### DELETE /api/v1/categories/:id
Açıklama: Soft-delete. Audit `DELETE`.
Yetki: Bearer token + `products:write` + `companies:all`
Yanıt: `204`
Hatalar: `403`, `404`, `409 CATEGORY_IN_USE` (silinmemiş alt kategori veya ürün var)

### POST /api/v1/brands · PATCH /api/v1/brands/:id
Açıklama: Marka oluşturur / adını değiştirir. Audit `CREATE` / `UPDATE`.
Yetki: Bearer token + `products:write` + `companies:all`
İstek: `{ "name" (1–150, baş/son boşluk kırpılır) }`
Yanıt: `201` / `200` `{ "data": Brand }`
Hatalar: `403`, `404` (PATCH), `409 BRAND_NAME_TAKEN` (aynı ad büyük/küçük harf duyarsız silinmemiş bir markada var), `422`

### DELETE /api/v1/brands/:id
Açıklama: Soft-delete. Audit `DELETE`.
Yetki: Bearer token + `products:write` + `companies:all`
Yanıt: `204`
Hatalar: `403`, `404`, `409 BRAND_IN_USE` (silinmemiş ürün bağlı)

### GET /api/v1/products
Açıklama: Erişilebilen firmaların silinmemiş ürünleri, yeniden eskiye.
Yetki: Bearer token + `products:read`
İstek (sorgu): `page` (varsayılan 1), `per_page` (varsayılan 20, en çok 100), `company_id`, `status` (`draft` | `active` | `archived`; yoksa hepsi), `category_id`, `brand_id`, `search` (ürün adı içinde (büyük/küçük harf duyarsız) veya silinmemiş bir varyantın SKU'su / barkodu başında (duyarlı))
Yanıt: `200` `{ "data": [Product], "meta": { "page", "per_page", "total" } }`. Erişimi olmayan bir `company_id` boş liste döner.
Hatalar: `401`, `403`, `422`

### GET /api/v1/products/:id
Yetki: Bearer token + `products:read` + ürünün firmasında `products:read` veren rol
Yanıt: `200` `{ "data": Product }`
Hatalar: `404` yok, silinmiş, başka tenant'a ait veya firmada rol yok (ayrım yapılmaz)

### POST /api/v1/products
Açıklama: Ürünü en az bir varyantla oluşturur. Audit: ürün ve her varyant için `CREATE`.
Yetki: Bearer token + `products:write` + firmada `products:write` veren rol
İstek: `{ "companyId", "name" (1–250), "description"?, "status"? (varsayılan `draft`), "categoryId"?, "brandId"?, "variants": [ { "sku" (1–100), "barcode"? (en çok 50) } ] (1–100 adet) }`. Baş/son boşluk kırpılır; boş barkod `null` sayılır.
Yanıt: `201` `{ "data": Product }`
Hatalar: `403`, `404` (firma yok veya firmada rol yok), `409 COMPANY_INACTIVE` (firma pasif), `409 SKU_TAKEN` / `409 BARCODE_TAKEN` (tenant içinde, tüm firmalarda ve **silinen varyantlar dahil** kullanılmış; aynı istekte tekrar eden SKU/barkod da), `422 CATEGORY_UNAVAILABLE` / `422 BRAND_UNAVAILABLE` (yok veya silinmiş), `422`

### PATCH /api/v1/products/:id
Açıklama: `name`, `description`, `status`, `categoryId`, `brandId` (yalnızca gönderilenler; `null` bağlantıyı kaldırır). Firma değiştirilemez. Arşivleme: `{ "status": "archived" }`. Audit `UPDATE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
Yanıt: `200` `{ "data": Product }`
Hatalar: `403`, `404`, `409 COMPANY_INACTIVE` (firma pasif), `422 CATEGORY_UNAVAILABLE` / `BRAND_UNAVAILABLE`, `422`

### DELETE /api/v1/products/:id
Açıklama: Ürünü ve silinmemiş varyantlarını soft-delete eder. SKU ve barkodlar yeniden kullanılamaz. Audit: her varyant ve ürün için `DELETE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
Yanıt: `204`
Hatalar: `403`, `404`, `409 COMPANY_INACTIVE` (firma pasif)

### POST /api/v1/products/:id/variants
Açıklama: Varyant ekler. Audit `CREATE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
İstek: `{ "sku", "barcode"? }`
Yanıt: `201` `{ "data": Variant }`
Hatalar: `403`, `404`, `409 COMPANY_INACTIVE` (firma pasif), `409 SKU_TAKEN` / `BARCODE_TAKEN`, `422`

### PATCH /api/v1/products/:id/variants/:variantId
Açıklama: SKU veya barkodu değiştirir (`barcode: null` kaldırır). Eski değer silinen varyantlarınki gibi rezerve kalmaz. Audit `UPDATE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
Yanıt: `200` `{ "data": Variant }`
Hatalar: `403`, `404` (ürün veya varyant), `409 COMPANY_INACTIVE` (firma pasif), `409 SKU_TAKEN` / `BARCODE_TAKEN`, `422`

### DELETE /api/v1/products/:id/variants/:variantId
Açıklama: Varyantı soft-delete eder. Audit `DELETE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
Yanıt: `204`
Hatalar: `403`, `404`, `409 COMPANY_INACTIVE` (firma pasif), `409 LAST_VARIANT` (ürünün son varyantı; ürünü silin veya arşivleyin)

### GET /api/v1/audit-logs
Açıklama: Tenant'ın işlem geçmişi, yeniden eskiye.
Yetki: Bearer token + `audit:read`
İstek (sorgu): `page` (varsayılan 1), `per_page` (varsayılan 20, en çok 100), `action`, `module`, `entity_type`, `entity_id`, `actor_user_id`, `from`, `to` (ISO 8601)
Yanıt: `200` `{ "data": [ { "id", "action", "module", "entityType", "entityId", "actorUserId", "before", "after", "ipAddress", "userAgent", "createdAt" } ], "meta": { "page", "per_page", "total" } }`
Hatalar: `401`, `403`, `422`

### GET /api/v1/audit-logs/:id
Açıklama: Tek kayıt.
Yetki: Bearer token + `audit:read`
Yanıt: `200` `{ "data": { ... } }`
Hatalar: `401`, `403`, `404` (yok veya başka tenant'a ait — ayrım yapılmaz), `422` (geçersiz UUID)

Audit log kayıtlarını değiştiren veya silen endpoint yoktur.

### POST /api/v1/invitations
Açıklama: E-posta daveti oluşturur ve bağlantıyı gönderir. Tam olarak biri: `tenantRole: "admin"` (yalnızca Owner verebilir) veya `companyRoles` (Owner/Admin; en az bir firma, her firma bir kez, firmalar bu tenant'ın aktif firmaları). Davet edenin rolü veritabanından okunur (`canGrant`); Owner'a davet yoktur. Davet transaction'da kaydedilir (audit `INVITATION_CREATED`), e-posta commit'ten sonra gönderilir; gönderim başarısızsa davet `pending` kalır, `delivery: "failed"` döner (`send_attempts`, `last_send_error` güncellenir). Yanıt, e-postanın başka bir tenant'ta hesabı olup olmadığına göre değişmez.
Yetki: Bearer token + `users:invite`
İstek: `{ "email": "...", "tenantRole": "admin" }` veya `{ "email": "...", "companyRoles": [ { "companyId": "<uuid>", "roleKey": "operations" | "accounting" | "viewer" } ] }`
Yanıt: `201` `{ "data": { "id", "status": "pending", "delivery": "sent" | "failed", "replacesInactiveMembership": false } }`
Hatalar: `400` `ROLE_REQUIRED` (ikisi birden veya hiçbiri), `COMPANY_REQUIRED`, `DUPLICATE_COMPANY`; `403` `FORBIDDEN` (izin yok), `ROLE_NOT_GRANTABLE` (rolü veremez, ör. Admin → Admin); `404` `NOT_FOUND` (firma yok, pasif veya başka tenant'ın); `409` `ALREADY_MEMBER` (bu tenant'ta aktif üye), `MEMBERSHIP_INACTIVE` (bu tenant'ta pasif üyelik — MVP'de davetle yeniden açılmaz, USR-T10b), `INVITATION_PENDING` (bekleyen davet var, süresi dolmuş olsa da; yeniden gönder kullanılır); `422`

### GET /api/v1/invitations
Açıklama: Tenant'ın bekleyen davetleri (en yeni önce, en çok 500). Süresi dolmuşlar `status: "expired"` ile döner. Token veya hash dönmez. `?status=` filtresi USR-T10b'de.
Yetki: Bearer token + `users:read`
Yanıt: `200` `{ "data": [ { "id", "email", "status": "pending" | "expired", "tenantRole", "companyRoles": [ { "companyId", "roleKey" } ], "invitedByUserId", "expiresAt", "lastSentAt", "sendAttempts", "lastSendError", "createdAt" } ] }`

### POST /api/v1/invitations/:id/resend
Açıklama: Yeni token üretir (eski bağlantı geçersiz olur), süreyi yeniden başlatır, e-postayı yeniden gönderir. Süresi dolmuş bekleyen bir daveti de canlandırır: yeni token ve şimdiden itibaren yeni `expiresAt` (`INVITATION_TTL_HOURS`). Audit `INVITATION_RESENT`. Çağıranın davetteki rolleri verebilmesi gerekir. Hız sınırları (davet başına 1/dk, tenant başına 50/saat) USR-T10b'de.
Yetki: Bearer token + `users:invite`
Yanıt: `200` `{ "data": { "id", "status": "pending", "delivery": "sent" | "failed" } }`
Hatalar: `403` `ROLE_NOT_GRANTABLE`, `404` `NOT_FOUND` (yok veya başka tenant'ın), `409` `INVITATION_NOT_PENDING`, `422` (geçersiz UUID)

### POST /api/v1/invitations/:id/revoke
Açıklama: Daveti `revoked` yapar; bağlantı geçersiz olur. Audit `INVITATION_REVOKED`.
Yetki: Bearer token + `users:invite`
Yanıt: `200` `{ "data": { "id", "status": "revoked" } }`
Hatalar: `403` `ROLE_NOT_GRANTABLE`, `404` `NOT_FOUND`, `409` `INVITATION_NOT_PENDING`, `422`

### POST /api/v1/invitations/lookup
Açıklama: Herkese açık. Davet bağlantısının bilgileri. Token yalnızca gövdede gelir (`/invite/<token>` sayfası BFF üzerinden gönderir). `accountExists` yalnızca geçerli token sahibine (davet edilen e-posta kutusuna) gösterilir. Pasif firmalar özetten çıkar; hiç aktif firma kalmadıysa, davet eden artık aktif üye değilse veya mağaza pasifse davet geçersizdir (accept ile aynı karar).
Yetki: yok; IP başına 10/dk
İstek: `{ "token": "<43 karakter base64url>" }`
Yanıt: `200` `{ "data": { "tenantName", "inviterName", "roleSummary", "maskedEmail": "a***@ornek.com", "accountExists": false, "replacesInactiveMembership": false } }`
Hatalar: `404` `INVITATION_INVALID` (bilinmeyen, iptal, süresi dolmuş, kullanılmış; ayrım yapılmaz), `422`, `429`, `503` (hız sınırı Redis'i yok)

### POST /api/v1/invitations/accept
Açıklama: Herkese açık. Daveti kabul eder. Hesap yoksa `name` (2–100) ve `password` (8–128) ile global hesap açılır; hesap varsa `password` o hesabın şifresidir (yalnızca token yetmez). Tek transaction: davet koşullu olarak `accepted` yapılır (eş zamanlı ikinci kabul `404`), mağaza aktif mi, davet eden hâlâ aktif üye ve rolü verebiliyor mu, firmalar aktif mi (pasifler atlanır) yeniden kontrol edilir, üyelik ve rol/firma atamaları yazılır, `email_verified_at` doldurulur. Bir adım başarısız olursa hiçbiri yazılmaz ve davet `pending` kalır. Audit: `INVITATION_ACCEPTED`, `MEMBERSHIP_CREATED`, `ROLE_CHANGED` (Admin) veya `COMPANY_ACCESS_CHANGED` (firma rolleri). **Token çifti dönmez, mağaza değiştirilmez**; kullanıcı normal login/switch-tenant akışını kullanır.
Yetki: yok; IP başına 10/dk
İstek: `{ "token": "...", "name"?: "...", "password": "..." }`
Yanıt: `200` `{ "data": { "tenantId", "tenantName" } }`
Hatalar: `401` `INVALID_CREDENTIALS` (mevcut hesabın şifresi yanlış veya hesap pasif; davet `pending` kalır; `/auth/login` ile aynı hesap/IP kilidine sayılır), `404` `INVITATION_INVALID`, `409` `ALREADY_MEMBER` / `MEMBERSHIP_INACTIVE` / `ACCOUNT_EXISTS` (bu e-postayla az önce hesap açıldı; davet `pending`, mevcut hesap şifresiyle tekrar deneyin), `422`, `429` (IP sınırı veya login kilidi), `503`

### Genel hata kodları
| Kod | HTTP | Anlam |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Girdi doğrulanamadı; `details` alan hatalarını içerir |
| `UNAUTHORIZED` | 401 | Token yok veya geçersiz |
| `SESSION_REVOKED` | 401 | Token geçerli ama üyelik pasif/yok, mağaza pasif veya kullanıcı pasif/silinmiş; yeniden giriş gerekir |
| `TOKEN_STALE` | 401 | Token'ın `ver`'i üyeliğin `auth_version`'ından farklı (rol/mağaza değişti); refresh yapıp isteği tekrarlayın |
| `FORBIDDEN` | 403 | İzin yok |
| `CONFLICT` | 409 | Tekil alan çakışması |
| `SKU_TAKEN`, `BARCODE_TAKEN`, `CATEGORY_SLUG_TAKEN`, `BRAND_NAME_TAKEN` | 409 | Katalogda tekil alan çakışması (bkz. Katalog) |
| `COMPANY_INACTIVE` | 409 | Pasif firmanın ürün/varyantları yazılamaz; okuma çalışır. Rol/izin kontrolü önce yapılır (rol yok `404`, izin yok `403`) |
| `CATEGORY_IN_USE`, `BRAND_IN_USE`, `LAST_VARIANT`, `CONCURRENT_UPDATE` | 409 | Katalog kaydı silinemez veya aynı anda değiştirildi |
| `CATEGORY_CYCLE`, `CATEGORY_UNAVAILABLE`, `BRAND_UNAVAILABLE` | 422 | Kategori döngüsü; bağlanan kategori/marka yok veya silinmiş |
| `TENANT_CONTEXT_MISSING` | 500 | Sorgu tenant bağlamı olmadan çalıştırıldı (geliştirici hatası) |
| `TENANT_VIOLATION` | 500 | Sorgu başka tenant'ın verisine dokunmaya çalıştı (geliştirici hatası) |
