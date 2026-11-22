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

### Varyant özellikleri (CAT-03)
Özellik (`Attribute`: renk, beden…) ve değerleri tenant genelidir; okuma `products:read`, yazma kategori/marka gibi `products:write` + `companies:all` (Owner, Admin). Audit `entityType`: `Attribute`, `AttributeValue`; varyantın özellik değişikliği `ProductVariant` `UPDATE` kaydında `attributes` alanıyla görünür.

`Attribute`: `{ "id", "name", "values": [ { "id", "value", "sortOrder" } ], "createdAt", "updatedAt" }` (değerler `sortOrder`, sonra `value` sırasıyla; silinenler yok).
`Variant` ek alanı: `"attributes": [ { "attributeId", "attributeName", "valueId", "value" } ]` (özellik adına göre sıralı).

### GET /api/v1/attributes · GET /api/v1/attributes/:id
Yetki: Bearer token + `products:read`
İstek (sorgu, liste): `page`, `per_page` (en çok 100), `search` (ad içinde, büyük/küçük harf duyarsız)
Yanıt: `200` `{ "data": [Attribute], "meta" }` · `{ "data": Attribute }`
Hatalar: `401`, `403`, `404`

### POST /api/v1/attributes · PATCH /api/v1/attributes/:id
İstek: `{ "name" (1–100), "values"? (yalnızca POST; en çok 100 metin, 1–100 karakter) }` · PATCH `{ "name" }`
Yetki: Bearer token + `products:write` + `companies:all`
Yanıt: `201`/`200` `{ "data": Attribute }`
Hatalar: `403`, `404`, `409 ATTRIBUTE_NAME_TAKEN` (büyük/küçük harf duyarsız), `409 ATTRIBUTE_VALUE_TAKEN` (istekte tekrar eden değer), `422`

### DELETE /api/v1/attributes/:id
Açıklama: Soft-delete; değerleri de silinir. Yanıt `204`.
Hatalar: `403`, `404`, `409 ATTRIBUTE_IN_USE` (silinmemiş bir varyant bu özelliği taşıyor)

### POST /api/v1/attributes/:id/values · PATCH /api/v1/attributes/:id/values/:valueId · DELETE …/values/:valueId
İstek: `{ "value" (1–100), "sortOrder"? (0–10000) }` (PATCH'te ikisi de isteğe bağlı)
Yanıt: `201`/`200` `{ "data": Attribute }` (güncel özellik) · DELETE `204`
Hatalar: `403`, `404` (özellik veya değer), `409 ATTRIBUTE_VALUE_TAKEN`, `409 ATTRIBUTE_VALUE_IN_USE` (silme; silinmemiş varyant kullanıyor), `422`

### Varyantlarda özellik
`POST /products` (her varyantta) ve `POST /products/:id/variants` isteğine `"attributes"?: [ { "attributeId", "valueId" } ]` (en çok 5, her özellik bir kez) eklenir. `PATCH …/variants/:variantId` aynı alanı alır: listelenen eksenlerin değeri eklenir veya değiştirilir, listelenmeyen eksenler aynen kalır (eksen kaldırma yok; yeni varyant oluşturup eskisini silin).
Ek hatalar: `422 ATTRIBUTE_UNAVAILABLE` (özellik/değer yok, silinmiş veya değer o özelliğe ait değil), `422 ATTRIBUTE_DUPLICATE` (aynı özellik iki kez), `409 VARIANT_COMBINATION_TAKEN` (ürünün silinmemiş başka bir varyantı aynı özellik-değer kümesini taşıyor; aynı istekteki varyantlar dahil).

### POST /api/v1/products/:id/variants/generate
Açıklama: Eksen değerlerinin kartezyen çarpımından varyant üretir. Ürünün silinmemiş varyantlarında zaten olan kombinasyonlar atlanır. SKU: `<skuPrefix>-<KOD1>-<KOD2>…`; kod değerin büyük harfe çevrilmiş, Türkçe karakterleri ASCII'ye indirgenmiş (`Ç→C, Ğ→G, İ/ı→I, Ö→O, Ş→S, Ü→U`), harf/rakam dışı karakterleri `-` olan ilk 20 karakteridir (ör. `TSHIRT-KIRMIZI-XL`). Barkod boş kalır. Tek transaction: bir SKU çakışırsa hiçbir varyant oluşmaz. Audit: her varyant için `CREATE`.
Yetki: Bearer token + `products:write` + firmada `products:write`
İstek: `{ "skuPrefix" (1–60), "axes": [ { "attributeId", "valueIds": [uuid] (1–50, tekrarsız) } ] (1–3 eksen, tekrarsız; çarpım en çok 100) }`
Yanıt: `201` `{ "data": { "created": [Variant], "skipped": <sayı> } }`
Hatalar: `403`, `404`, `409 COMPANY_INACTIVE`, `409 SKU_TAKEN` (üretilen bir SKU kullanılmış), `422 ATTRIBUTE_UNAVAILABLE`, `422 ATTRIBUTE_DUPLICATE`, `422 TOO_MANY_COMBINATIONS` (çarpım 100'den büyük), `422`

### Fiyat ve KDV (CAT-05)
Tutarlar ondalık **metin** olarak gönderilir ve döner (`"199.90"`); en çok 2 ondalık basamak, nokta ayırıcı; fazlası `422`. Fiyatlar KDV dahildir. Yuvarlama ve kurallar: `docs/DATABASE.md` "fiyat ve KDV".

`Product` ek alanı: `"vatRate": "20.00" | null`. `Variant` ek alanı: `"prices": [Price]` (kanal koduna göre, `list` önce).
`Price`: `{ "channel": "list" | "<kanal>", "amount": "199.90", "currency": "TRY", "netAmount": "166.58" | null, "vatAmount": "33.32" | null, "updatedAt" }` (`netAmount`/`vatAmount` ürünün `vatRate`'i yoksa `null`).

`POST /products` ve `PATCH /products/:id` isteğine `"vatRate"?: "0" | "1" | "10" | "20" | null` eklenir (başka değer `422`). `POST /products` içindeki her varyant ve `POST /products/:id/variants` isteği `"prices"?: [ { "channel", "amount", "currency" } ]` (en çok 20, kanal başına bir) alabilir.

### PUT /api/v1/products/:id/variants/:variantId/prices/:channel
Açıklama: Varyantın o kanaldaki fiyatını yazar (yoksa oluşturur). `channel`: `list` (liste fiyatı) veya kanal kodu (`^[a-z0-9]+(-[a-z0-9]+)*$`, en çok 50). Audit: `entityType: "VariantPrice"`, `CREATE` veya `UPDATE` (`before`/`after` tutar ve para birimi).
Yetki: Bearer token + `products:write` + firmada `products:write`
İstek: `{ "amount": "199.90", "currency": "TRY" | "USD" | "EUR" }`
Yanıt: `200` `{ "data": Variant }`
Hatalar: `403`, `404` (ürün/varyant yok veya geçersiz kanal kodu), `409 COMPANY_INACTIVE`, `409 CONCURRENT_UPDATE`, `422` (tutar biçimi, para birimi)

### DELETE /api/v1/products/:id/variants/:variantId/prices/:channel
Açıklama: Fiyatı soft-delete eder. Audit `DELETE`. Yanıt `204`.
Hatalar: `403`, `404` (fiyat yok), `409 COMPANY_INACTIVE`

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

### BFF: POST /api/invitations/lookup, POST /api/invitations/accept
Açıklama: Oturumsuz; `invitations/lookup` ve `invitations/accept`'i backend'e iletir (yalnızca `token` / `token`, `name`, `password`). Oturum başlatmaz; kabulden sonra kullanıcı giriş yapar. Kullanıcı yönetimi uç noktaları (`users`, `invitations`, `invitations/:id/revoke`) oturumlu `/api/bff/*` üzerinden çağrılır.
Hatalar: `400` (gövde JSON nesnesi değil), `403` `CSRF_REJECTED`, `413`, `415`; diğerleri backend'den aynen (`404 INVITATION_INVALID`, `429` + `Retry-After` vb.)

### GET /api/v1/users
Açıklama: Mevcut tenant'ın üyeleri (aktif ve pasif). Başka tenant'ın üyeleri hiç görünmez. Parola, hash veya token dönmez. `lastLoginAt` mevcut global hesabın son başarılı giriş zamanıdır (ISO 8601); hiç giriş yoksa `null`. Kaynak mağaza, IP ve oturum bilgisi içermez.
Yetki: Bearer token + `users:read`
Yanıt: `200` `{ "data": [ { "userId", "name", "email", "status": "active" | "inactive", "lastLoginAt": "<ISO 8601>" | null, "access": { "tenantRole": "owner" | "admin" } | { "companyRoles": [ { "companyId", "companyName", "roleKey" } ] } } ] }`
Hatalar: `401`, `403`

### GET /api/v1/users/:userId
Açıklama: Mevcut tenant'ın aktif veya pasif bir üyesinin detayı. Listeyle aynı sınırlı profil alanlarını ve yalnız mevcut tenant'taki erişimlerini döndürür. Global kullanıcı ID'sini bilmek başka tenant'ın profilini okumaya yetmez. BFF/UI bu backend diliminin kapsamında değildir.
Yetki: Bearer token + `users:read`; yetki hedef aranmadan önce kontrol edilir.
Yanıt: `200` `{ "data": { "userId", "name", "email", "status", "lastLoginAt", "access" } }` (alan biçimleri listeyle aynı).
Hatalar: `401`; `403 FORBIDDEN`; `404 NOT_FOUND` (olmayan veya başka tenant'ın kullanıcısı: aynı hata gövdesi); `422 VALIDATION_ERROR` (geçersiz UUID).

### PUT /api/v1/users/:userId/access
Açıklama: Üyenin erişiminin **tamamını** değiştirir. Tam olarak biri: `tenantRole: "admin"` (yalnızca Owner verir) veya `companyRoles` (Owner/Admin; en az bir firma, her firma bir kez, bu tenant'ın aktif firmaları). Owner'ın rolü ve erişimi değiştirilemez (sahiplik devri USR-21). Admin, Owner'a veya başka bir Admin'e dokunamaz; kimse kendi erişimini değiştiremez. İşlemi yapanın rolü veritabanından okunur. Değişiklik tek transaction'dadır; üyenin açık access token'ları bir sonraki istekte `TOKEN_STALE` alır. Audit: `ROLE_CHANGED` (tenant rolü önce/sonra), `COMPANY_ACCESS_CHANGED` (firma rolleri önce/sonra, eklenen/çıkarılan).
Yetki: Bearer token + `users:manage`
İstek: `{ "tenantRole": "admin" }` veya `{ "companyRoles": [ { "companyId": "<uuid>", "roleKey": "operations" | "accounting" | "viewer" } ] }`
Yanıt: `200` `{ "data": { "userId", "access": { ... } } }`
Hatalar: `400` `ROLE_REQUIRED` (ikisi birden veya hiçbiri), `COMPANY_REQUIRED`, `DUPLICATE_COMPANY`; `403` `FORBIDDEN`, `SELF_CHANGE`, `OWNER_IMMUTABLE` (hedef Owner), `ROLE_NOT_GRANTABLE` (Admin → Owner/Admin hedefi veya Admin rolü verme); `404` `NOT_FOUND` (üye yok veya başka tenant'ın — ayrım yapılmaz; firma yok, pasif veya başka tenant'ın); `422` (geçersiz UUID, `roleKey`)

### POST /api/v1/users/:userId/deactivate
### POST /api/v1/users/:userId/activate
Açıklama: Üyeliği bu tenant'ta pasife alır / aktifleştirir. Pasife alma rol ve firma atamalarını **korur**; üyenin bu tenant'taki oturumlarını bitirir (sonraki istek `401 SESSION_REVOKED`, bu tenant'taki refresh token'lar iptal). Kullanıcının diğer mağazalarına ve global hesabına dokunulmaz. Aktifleştirme atamaları geri getirir; eski refresh token'lar iptal kaldığından yeniden giriş gerekir. Aynı durumu tekrar istemek bir şey değiştirmez (`200`). Owner'ı yalnızca başka bir Owner pasife alır ve en az bir Owner aktif kalmalıdır; kontrol, Owner üyeliklerinin satır kilidinden sonra yapılır (eş zamanlı istekler de geçemez). Audit: `MEMBERSHIP_DEACTIVATED` / `MEMBERSHIP_ACTIVATED`.
Yetki: Bearer token + `users:manage`
Yanıt: `200` `{ "data": { "userId", "status": "inactive" | "active" } }`
Hatalar: `403` `FORBIDDEN` (izin yok veya aktör pasif; hedefin üyeliği açıklanmaz), `SELF_CHANGE`, `ROLE_NOT_GRANTABLE` (Admin → Owner/Admin); `404` `NOT_FOUND`; `409` `LAST_OWNER` (ek savunma; normalde oluşmaz — eş zamanlı istekte kaybeden `403` alır); `422` (geçersiz UUID)

### POST /api/v1/invitations
Açıklama: E-posta daveti oluşturur ve bağlantıyı gönderir. Tam olarak biri: `tenantRole: "admin"` (yalnızca Owner verebilir) veya `companyRoles` (Owner/Admin; en az bir firma, her firma bir kez, firmalar bu tenant'ın aktif firmaları). Davet edenin rolü veritabanından okunur (`canGrant`); Owner'a davet yoktur. Davet transaction'da kaydedilir (audit `INVITATION_CREATED`), e-posta commit'ten sonra gönderilir; gönderim başarısızsa davet `pending` kalır, `delivery: "failed"` döner (`send_attempts`, `last_send_error` güncellenir). Yanıt, e-postanın başka bir tenant'ta hesabı olup olmadığına göre değişmez.
Yetki: Bearer token + `users:invite`
İstek: `{ "email": "...", "tenantRole": "admin" }` veya `{ "email": "...", "companyRoles": [ { "companyId": "<uuid>", "roleKey": "operations" | "accounting" | "viewer" } ] }`
Yanıt: `201` `{ "data": { "id", "status": "pending", "delivery": "sent" | "failed", "replacesInactiveMembership": boolean } }` — `true`: kişinin bu mağazada pasif üyeliği var; kabulde üyelik yeniden açılır, eski rol ve firma erişimleri davettekilerle değiştirilir (USR-T10b)
Hatalar: `400` `ROLE_REQUIRED` (ikisi birden veya hiçbiri), `COMPANY_REQUIRED`, `DUPLICATE_COMPANY`; `403` `FORBIDDEN` (izin yok), `ROLE_NOT_GRANTABLE` (rolü veremez, ör. Admin → Admin); `404` `NOT_FOUND` (firma yok, pasif veya başka tenant'ın); `409` `ALREADY_MEMBER` (bu tenant'ta aktif üye), `INVITATION_PENDING` (bekleyen davet var, süresi dolmuş olsa da; yeniden gönder kullanılır); `422`

### GET /api/v1/invitations
Açıklama: Tenant'ın bekleyen davetleri (en yeni önce, en çok 500). Süresi dolmuşlar `status: "expired"` ile döner. Token veya hash dönmez. `?status=pending|expired|accepted|revoked` ile süzülür (USR-T10b); parametresiz istek bekleyen tüm davetleri döner, geçersiz değer `422`.
Yetki: Bearer token + `users:read`
Yanıt: `200` `{ "data": [ { "id", "email", "status": "pending" | "expired", "tenantRole", "companyRoles": [ { "companyId", "roleKey" } ], "invitedByUserId", "expiresAt", "lastSentAt", "sendAttempts", "lastSendError", "createdAt" } ] }`

### POST /api/v1/invitations/:id/resend
Açıklama: Yeni token üretir (eski bağlantı geçersiz olur), süreyi yeniden başlatır, e-postayı yeniden gönderir. Süresi dolmuş bekleyen bir daveti de canlandırır: yeni token ve şimdiden itibaren yeni `expiresAt` (`INVITATION_TTL_HOURS`). Audit `INVITATION_RESENT`. Çağıranın davetteki rolleri verebilmesi gerekir. Hız sınırları: aynı davet dakikada 1 kez; mağaza başına davet e-postası (oluşturma + yeniden gönderme) saatte 50; aşılınca `429`.
Yetki: Bearer token + `users:invite`
Yanıt: `200` `{ "data": { "id", "status": "pending", "delivery": "sent" | "failed" } }`
Hatalar: `403` `ROLE_NOT_GRANTABLE`, `404` `NOT_FOUND` (yok veya başka tenant'ın), `409` `INVITATION_NOT_PENDING`, `422` (geçersiz UUID), `429` (hız sınırı)

### POST /api/v1/invitations/:id/revoke
Açıklama: Daveti `revoked` yapar; bağlantı geçersiz olur. Audit `INVITATION_REVOKED`.
Yetki: Bearer token + `users:invite`
Yanıt: `200` `{ "data": { "id", "status": "revoked" } }`
Hatalar: `403` `ROLE_NOT_GRANTABLE`, `404` `NOT_FOUND`, `409` `INVITATION_NOT_PENDING`, `422`

### POST /api/v1/invitations/lookup
Açıklama: Herkese açık. Davet bağlantısının bilgileri. Token yalnızca gövdede gelir (`/invite/<token>` sayfası BFF üzerinden gönderir). `accountExists` yalnızca geçerli token sahibine (davet edilen e-posta kutusuna) gösterilir. Pasif firmalar özetten çıkar; hiç aktif firma kalmadıysa, davet eden artık aktif üye değilse veya mağaza pasifse davet geçersizdir (accept ile aynı karar).
Yetki: yok; IP başına 10/dk
İstek: `{ "token": "<43 karakter base64url>" }`
Yanıt: `200` `{ "data": { "tenantName", "inviterName", "roleSummary", "maskedEmail": "a***@ornek.com", "accountExists": false, "replacesInactiveMembership": false } }` (`replacesInactiveMembership` `true` ise kabul sayfası eski erişimin değişeceği uyarısını gösterir)
Hatalar: `404` `INVITATION_INVALID` (bilinmeyen, iptal, süresi dolmuş, kullanılmış; ayrım yapılmaz), `422`, `429`, `503` (hız sınırı Redis'i yok)

### POST /api/v1/invitations/accept
Açıklama: Herkese açık. Daveti kabul eder. Hesap yoksa `name` (2–100) ve `password` (8–128) ile global hesap açılır; hesap varsa `password` o hesabın şifresidir (yalnızca token yetmez). Tek transaction: davet koşullu olarak `accepted` yapılır (eş zamanlı ikinci kabul `404`), mağaza aktif mi, davet eden hâlâ aktif üye ve rolü verebiliyor mu, firmalar aktif mi (pasifler atlanır) yeniden kontrol edilir, üyelik ve rol/firma atamaları yazılır, `email_verified_at` doldurulur. Pasif üyelik varsa yeniden açılır, eski rol ve firma erişimleri silinip davettekiler yazılır, `auth_version` artırılır (audit `MEMBERSHIP_ACTIVATED`, USR-T10b). Bir adım başarısız olursa hiçbiri yazılmaz ve davet `pending` kalır. Audit: `INVITATION_ACCEPTED`, `MEMBERSHIP_CREATED`, `ROLE_CHANGED` (Admin) veya `COMPANY_ACCESS_CHANGED` (firma rolleri). **Token çifti dönmez, mağaza değiştirilmez**; kullanıcı normal login/switch-tenant akışını kullanır.
Yetki: yok; IP başına 10/dk
İstek: `{ "token": "...", "name"?: "...", "password": "..." }`
Yanıt: `200` `{ "data": { "tenantId", "tenantName" } }`
Hatalar: `401` `INVALID_CREDENTIALS` (mevcut hesabın şifresi yanlış veya hesap pasif; davet `pending` kalır; `/auth/login` ile aynı hesap/IP kilidine sayılır), `404` `INVITATION_INVALID`, `409` `ALREADY_MEMBER` / `ACCOUNT_EXISTS` (bu e-postayla az önce hesap açıldı; davet `pending`, mevcut hesap şifresiyle tekrar deneyin), `422`, `429` (IP sınırı veya login kilidi), `503`

### POST /api/v1/invitations/accept-as-current
Açıklama: USR-T10b. Oturum açık kullanıcı, kendi e-postasına gelen daveti şifre girmeden kabul eder (oturum hesabı kanıtlar). Kabul adımları ve audit `accept` ile aynıdır. Davet başka bir hesaba aitse reddedilir ve davet `pending` kalır. **Token çifti dönmez, mağaza değiştirilmez.** BFF: `POST /api/bff/invitations/accept-as-current`.
Yetki: Bearer token; IP başına 10/dk
İstek: `{ "token": "..." }`
Yanıt: `200` `{ "data": { "tenantId", "tenantName" } }`
Hatalar: `401` (oturum yok), `403` `INVITATION_OTHER_ACCOUNT`, `404` `INVITATION_INVALID`, `409` `ALREADY_MEMBER`, `422`, `429`, `503`

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
| `ATTRIBUTE_NAME_TAKEN`, `ATTRIBUTE_VALUE_TAKEN`, `ATTRIBUTE_IN_USE`, `ATTRIBUTE_VALUE_IN_USE`, `VARIANT_COMBINATION_TAKEN` | 409 | Varyant özelliği çakışması veya kullanımda (bkz. Varyant özellikleri) |
| `ATTRIBUTE_UNAVAILABLE`, `ATTRIBUTE_DUPLICATE`, `TOO_MANY_COMBINATIONS` | 422 | Özellik/değer yok veya silinmiş; aynı eksen iki kez; varyant üretiminde 100'den fazla kombinasyon |
| `TENANT_CONTEXT_MISSING` | 500 | Sorgu tenant bağlamı olmadan çalıştırıldı (geliştirici hatası) |
| `TENANT_VIOLATION` | 500 | Sorgu başka tenant'ın verisine dokunmaya çalıştı (geliştirici hatası) |

### Senkron logu (INT-02)

Yetki: `channels:manage` (kanal hesabıyla aynı). Başka tenant ya da firmanın hesabı/işi → 404.

#### GET /api/v1/companies/:companyId/channel-accounts/:accountId/sync-jobs

Sorgu: `status` (`queued|running|succeeded|failed`), `limit` (1–100, varsayılan 20), `cursor` (önceki yanıttaki `nextCursor`; başka hesaba ait imleç → 422 `INVALID_CURSOR`). Yeniden eskiye sıralı.

Yanıt `{ data: [{ id, kind, status, attempts, errorCode, errorMessage, stats, queuedAt, startedAt, finishedAt }], nextCursor }`. `payload` dönmez; `errorMessage` koddan üretilen Türkçe metindir.

#### POST /api/v1/companies/:companyId/channel-accounts/:accountId/sync-jobs/:syncJobId/retry

`failed` işler ile kuyruk işi artık var olmayan `queued`/`running` işler için 202. Kuyrukta bekleyen veya çalışan iş → 409 `SYNC_JOB_ACTIVE`. Durum değişimi tek koşullu UPDATE ile yapılır; eşzamanlı iki istekten biri 409 alır. Başarıyla bitmiş iş → 409 `SYNC_JOB_NOT_FAILED`; kuyruk erişilemezse 503 `SYNC_QUEUE_UNAVAILABLE`.

İş başlatma ucu yok: işler INT-TY-* modüllerinden `SyncService.start` ile başlatılır.

### Entegrasyon yönetimi (INT-03)

Yetki: `channels:manage` (mağaza sahibi, Admin).

#### GET /api/v1/channel-definitions

Kanal başına kimlik bilgisi alanları: `{ data: [{ code, name, credentialFields: [{ key, label, secret, maxLength }], connectionTest }] }`. Doğrulama desenleri ve sırlar dönmez.

#### POST /api/v1/companies/:companyId/channel-accounts/:id/test-connection

Kayıtlı kimlik bilgileriyle pazaryerine tek bir salt-okuma isteği gönderir (Trendyol: 1 ürünlük liste). Yanıt her zaman 200: `{ data: { ok, code, message } }`.

Kodlar: `OK`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `UNAVAILABLE`, `UNKNOWN`, `ACCOUNT_INACTIVE`, `SYNC_LIVE_CALLS_DISABLED` (canlı çağrılar kapalıyken istek gönderilmez), `CHANNEL_RATE_LIMITED`, `NOT_SUPPORTED`.

Hesap başına dakikada en fazla 5 test yapılabilir (aşılırsa 429). Pazaryeri yanıt gövdesi okunmaz ve dönmez.

### Siparişler (ORD-02)

Yetki: `orders:read` (Owner, Admin, Operasyon, Muhasebe, Görüntüleyici), `orders:write` (Owner, Admin, Operasyon). Erişim, siparişin firmasındaki role göre her istekte veritabanından okunur: firmada rol yoksa 404, izin yoksa 403. Tutarlar her zaman ondalık metindir (`"199.90"`).

#### GET /api/v1/orders

Sorgu: `page`, `per_page` (≤ 100), `company_id`, `status`, `channel`, `search` (pazaryeri sipariş no, başından eşleşir). Yanıt `{ data: [order], meta: { page, per_page, total } }`; en yeni sipariş önce; kalemler listede dönmez.

`order`: `{ id, companyId, channel, channelAccountId, externalOrderNo, status, currency, subtotal, discountTotal, channelDiscountTotal, shippingTotal, total, orderedAt, createdAt, updatedAt }`.

#### GET /api/v1/orders/:id

`order` + `items: [{ id, variantId, externalLineId, sku, name, quantity, unitPrice, discount, vatRate, lineTotal }]` + `statusHistory: [{ id, fromStatus, toStatus, source, changedBy, changedAt }]`. Müşteri kişisel verisi yok (CRM-01).

#### POST /api/v1/orders

Elle sipariş (`channel = "manual"`). Gövde: `{ companyId, currency (TRY|USD|EUR), orderedAt?, discountTotal?, shippingTotal?, items: [{ variantId, quantity (1–100000), unitPrice, discount? }] (1–100) }`. Kalemler firmanın etkin varyantlarının o anki kopyasıdır (sku, ürün adı, KDV oranı). `lineTotal = quantity × unitPrice − discount`, `subtotal = Σ lineTotal`, `total = subtotal − discountTotal + shippingTotal` (decimal, yuvarlama yok). 201 → detay.

Hatalar: 404 `NOT_FOUND` (firma yok/erişim yok), 409 `COMPANY_INACTIVE`, 422 `VARIANT_NOT_FOUND` (yok, silinmiş veya başka firmanın), 422 `ORDER_ITEM_DUPLICATE`, 422 `VALIDATION_ERROR` (indirim tutarı aşıyor, sayı olarak tutar, 2'den fazla ondalık).

#### POST /api/v1/orders/:id/status

Gövde `{ status }`. Geçişler `backend/src/orders/order-status.ts` tablosuna göre (13 × 13 tablonun tamamı testli). Durum yalnızca okunan durum hâlâ geçerliyse değişir; her geçiş `order_status_history`'e (source `user`) ve Audit Log'a yazılır. 200 → detay.

Hatalar: 409 `ORDER_TRANSITION_INVALID`, 409 `CONCURRENT_UPDATE` (eşzamanlı değişiklik), 409 `CHANNEL_MANAGED` (pazaryeri siparişi: durum pazaryerinden gelir, INT-TY-03), 422 bilinmeyen durum, 404.

### Stok (INV-02)

Yetki: `inventory:read` (tüm roller), `inventory:write` (Owner, Admin, Operasyon); firma rolü her istekte veritabanından okunur (rol yok → 404, izin yok → 403). Stok yalnızca hareketlerle değişir; pazaryerine hiçbir şey gönderilmez.

- `GET /api/v1/warehouses?company_id` → `{ data: [{ id, companyId, name, isDefault, isActive, createdAt, updatedAt }] }`
- `POST /api/v1/warehouses` `{ companyId, name, isDefault? }` → 201. 409 `WAREHOUSE_NAME_TAKEN` (büyük/küçük harf duyarsız), 409 `WAREHOUSE_DEFAULT_TAKEN`, 409 `COMPANY_INACTIVE`.
- `GET /api/v1/stock-levels?company_id&warehouse_id&variant_id&page&per_page` → `{ data: [{ id, companyId, warehouseId, warehouseName, variantId, sku, productName, onHand, reserved, available, updatedAt }], meta }`. `available = onHand − reserved`.
- `POST /api/v1/stock-movements` `{ warehouseId, variantId, quantity (≠ 0), reason: opening | adjustment | count | purchase }` → 201. Açılış/satın alma pozitif olmalı (422). Stok eksiye düşecekse 409 `STOCK_INSUFFICIENT`; ayrılmış stoğa dokunacaksa 409 `STOCK_RESERVED`. `order` hareketleri yalnızca sevkiyatta otomatik yazılır.
- `GET /api/v1/stock-movements?warehouse_id&variant_id&limit` → en yeni önce.
- `POST /api/v1/orders/:id/reserve` `{ warehouseId? }` (varsayılan: firmanın varsayılan deposu) → 200 sipariş detayı. Eşleşmiş tüm kalemler ayrılır ya da hiçbiri. 409 `STOCK_INSUFFICIENT`, 409 `STOCK_ALREADY_RESERVED`, 409 `ORDER_NOT_RESERVABLE` (sevk edilmiş/son durum), 409 `WAREHOUSE_REQUIRED`, 404 (depo yok/pasif/başka firma). Aynı istek tekrarlanırsa değişiklik olmaz.
- Durum geçişi `shipped` rezervasyonu stok düşümüne çevirir; `cancelled`/`unsupplied` serbest bırakır.
- `POST /api/v1/stock-transfers` `{ fromWarehouseId, toWarehouseId, variantId, quantity (1–1000000) }` (`inventory:write`, INV-04) → 201 `{ data: { transferId, quantity } }`. Aynı işlemde iki hareket: kaynakta `transfer_out`, hedefte `transfer_in`, ikisi de `reference_type = transfer`, aynı `reference_id`. Aynı depo veya farklı firmanın deposu 422; yetersiz (ayrılmış dahil) stok 409 `STOCK_INSUFFICIENT` / `STOCK_RESERVED`, hiçbir şey yazılmaz.
- `POST /api/v1/stock-counts` `{ warehouseId, variantId, counted (0–1000000) }` (`inventory:write`, INV-04) → 201 `{ data: { counted, difference } }`. Sayılan ile eldeki arasındaki fark tek `count` hareketi olarak yazılır (fark 0 ise yazılmaz). SERIALIZABLE; eşzamanlı satışla çakışırsa 409 `CONCURRENT_UPDATE`. Ayrılmış stoğun altına sayım 409 `STOCK_RESERVED`. Arayüz: Stok sayfası → "Transfer / sayım".
- `PUT /api/v1/stock-thresholds/:variantId` `{ threshold: 0–1000000 | null }` (`inventory:write`) → `{ data: { variantId, threshold } }`; `null` eşiği kaldırır. Varyant yok/başka firma → 404.
- `GET /api/v1/stock-levels/low?company_id` (`inventory:read`) → `{ data: [{ variantId, companyId, sku, productName, threshold, available }] }`: tüm depolarda kullanılabilir toplamı eşiğe eşit veya altında olanlar, en acil olan önce. `GET /stock-levels` satırları `threshold` alanını da taşır.

### Raporlar (RPT-01)

#### GET /api/v1/reports/sales

Yetki: `orders:read`; yalnızca üyenin rolü olan firmaların siparişleri (firma rolü veritabanından okunur). Sorgu: `from`, `to` (`YYYY-AA-GG`, İstanbul takvim günü, ikisi dahil; en çok 366 gün), `group_by` (`day` | `channel` | `product`, varsayılan `day`), `company_id?`, `channel?`.

Yanıt `{ data: [{ key, label, currency, orders, quantity, revenue, returned }], meta: { from, to, groupBy, totals: [{ currency, orders, revenue, returned }], excludedStatuses } }`.

- `cancelled` ve `unsupplied` siparişler satış sayılmaz. `returned` siparişler ciroya girmez, `returned` sütununda sayılır.
- Ciro: `day`/`channel` için sipariş toplamı, `product` için satır toplamı. Para birimleri asla toplanmaz (satır ve toplamlar para birimi başına). Tutarlar decimal metin; yuvarlama yok.
- Gün, siparişin İstanbul saatine göre tarihidir.
- Dönemde 20 000'den fazla sipariş varsa 422 `REPORT_TOO_LARGE`; geçersiz aralık 422 `VALIDATION_ERROR`.

### Toplu ürün içe aktarma (IMP-01)

Yetki: `products:write` ve firmada ürün yazma rolü. Senkron, satır sınırlı (asenkron iş: IMP-02).

#### GET /api/v1/imports/products/template

`text/csv` şablon (UTF-8 BOM, `;` ayraç): `urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi`. Her satır bir varyant; aynı ürün adlı satırlar (büyük/küçük harf duyarsız) tek ürünün varyantları olur. Arayüz şablonu kendisi üretir (aynı kolonlar, testli).

#### POST /api/v1/imports/products

Gövde `{ companyId, csv (en çok 95 000 karakter; genel 100 KB gövde sınırı yükseltilmedi), dryRun? (varsayılan true) }`. En çok 1000 satır; ayraç `;` veya `,` otomatik.

Yanıt 200 `{ data: { rows, products, variants, errors: [{ row, column, message }], dryRun, created, productIds? } }`. `row` dosyadaki satır numarasıdır (başlık = 1).

- Doğrulama: zorunlu ad/SKU, uzunluklar, KDV (0/1/10/20), fiyat (virgül veya nokta, en çok 2 ondalık), para birimi, dosya içinde tekrar eden SKU (büyük/küçük harf duyarsız) ve barkod, aynı ürünün satırlarında farklı KDV, veritabanında zaten olan SKU/barkod (silinmiş varyantlar dahil).
- **CSV/formül enjeksiyonu:** `=`, `+`, `-`, `@`, sekme veya satır başı ile başlayan her hücre reddedilir (hiçbir kolonun işaretli değere ihtiyacı yok).
- `dryRun: false` yalnızca hata yoksa yazar; ürünler `ProductsService.create` ile tek tek oluşturulur (aynı kurallar ve Audit Log). Arada bir ürün başarısız olursa 422 `IMPORT_STOPPED` (kaç ürün oluşturulduğu mesajda).
- 404 firma yok / erişim yok.

### Dashboard (DSH-02)

#### GET /api/v1/dashboard/kpis?company_id

Tek bir izin istemez; her KPI kendi iznine bakar, görülemiyorsa `null` döner (kısmi sayı asla). Yanıt `{ data: { day, todaySales, pendingShipment, lowStock, integrationErrors } }`:
- `day`: İstanbul tarihi (`YYYY-AA-GG`).
- `todaySales` (`orders:read`): `GET /reports/sales?from=day&to=day` ile **aynı** `meta.totals` (para birimi başına; iptal/tedarik edilemeyen hariç, iade ayrı).
- `pendingShipment` (`orders:read`): `awaiting, created, picking, invoiced, unpacked, repack` durumundaki siparişler.
- `lowStock` (`inventory:read`): `GET /stock-levels/low` satır sayısı.
- `integrationErrors` (`channels:manage`): son 7 günde başarısız senkron işleri.
Hepsi üyenin firma rollerine göre süzülür.

### Dışa aktarma (IMP-04)

`GET /api/v1/exports/products?company_id` (`products:read`) ve `GET /api/v1/exports/stock?company_id` (`inventory:read`) → `{ data: { filename, rows, csv } }`. Yalnızca üyenin okuyabildiği firmalar (firma rolleri veritabanından).

- CSV: UTF-8 BOM, `;` ayraç, tutarlar `249,90` biçiminde. Ürün dosyası içe aktarma şablonuyla **aynı kolonlardadır** (düzenlenip yeniden içe aktarılabilir); stok dosyası: `urun_adi;sku;depo;eldeki;ayrilmis;kullanilabilir;esik`.
- `=`, `+`, `-`, `@`, sekme veya CR ile başlayan her hücrenin başına `'` eklenir (CSV/formül enjeksiyonu); `;`, `"` veya satır sonu içeren hücreler tırnaklanır.
- En çok 20 000 satır (fazlası 422 `EXPORT_TOO_LARGE`; firma seçerek daraltın).

### Ürün görselleri (IMG-01)

`/api/v1/products/:id/images` — yetkiler ürünle aynı (firma rolü yok 404, salt okuma 403, firma pasif 409).

- `GET` → `{ data: [{ id, variantId, contentType, width, height, byteSize, position, createdAt, url }] }`; `url` kısa ömürlü imzalı bağlantıdır, depolama anahtarı dönmez.
- `POST ?variant_id` — gövde ham bayt, `Content-Type: application/octet-stream` (415), en çok 8 MB (413). Tür içerikten belirlenir: JPEG/PNG/WebP (422 `IMAGE_TYPE_UNSUPPORTED`); bozuk veya 25 MP üstü 422 `IMAGE_INVALID`; kısa kenar < 100 px 422 `IMAGE_TOO_SMALL`; işlenmiş hali 10 MB üstü 422 `IMAGE_TOO_LARGE`; ürün başına 20 (409 `IMAGE_LIMIT`); kullanıcı başına 60 yükleme/dk (429); süreç/mağaza başına eşzamanlı 24/4 okuma, 6/2 işleme (503 `UPLOAD_BUSY`); 30 sn'de gelmeyen gövde 408. Görsel yeniden kodlanır: yön uygulanır, EXIF/GPS/XMP ve fazladan baytlar atılır.
- `PUT /order` `{ imageIds }` — güncel görsellerin tamamı (422 `IMAGE_ORDER_MISMATCH`).
- `PATCH /:imageId` `{ variantId | null }`; varyant aynı ürünün olmalı (404).
- `DELETE /:imageId` → 204; satır soft delete, nesne silinir (silinemezse sahipsiz kalır, loglanır).
- Depolama kapalıysa 503 `STORAGE_DISABLED`. Frontend CSP `img-src` yalnızca `STORAGE_ENDPOINT` origin'ini ekler (`next build` sırasında ayarlı olmalı).
