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
Açıklama: Uygulamanın ve veritabanı bağlantısının durumunu döner.
Yetki: Yok (herkese açık)
İstek: —
Yanıt: `200` `{ "data": { "status": "ok", "database": "up" } }`
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

### Genel hata kodları
| Kod | HTTP | Anlam |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Girdi doğrulanamadı; `details` alan hatalarını içerir |
| `UNAUTHORIZED` | 401 | Token yok veya geçersiz |
| `SESSION_REVOKED` | 401 | Token geçerli ama üyelik pasif/yok, mağaza pasif veya kullanıcı pasif/silinmiş; yeniden giriş gerekir |
| `TOKEN_STALE` | 401 | Token'ın `ver`'i üyeliğin `auth_version`'ından farklı (rol/mağaza değişti); refresh yapıp isteği tekrarlayın |
| `FORBIDDEN` | 403 | İzin yok |
| `CONFLICT` | 409 | Tekil alan çakışması |
| `TENANT_CONTEXT_MISSING` | 500 | Sorgu tenant bağlamı olmadan çalıştırıldı (geliştirici hatası) |
| `TENANT_VIOLATION` | 500 | Sorgu başka tenant'ın verisine dokunmaya çalıştı (geliştirici hatası) |
