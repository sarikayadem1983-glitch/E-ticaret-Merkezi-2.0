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

### BFF: POST /api/session/tenant
Açıklama: Tarayıcının mağaza değiştirme çağrısı. CSRF kontrolü (§5 SECURITY.md) uygulanır. Backend `switch-tenant` başarılıysa yeni token'lar her zaman yeni oturum kimliğiyle saklanır (kimlik `auth/me`'den, o başarısızsa access token'ın `sub`/`tid` claim'lerinden), eski oturum kimliği silinir (eski refresh token backend'de iptal edildiği için asla kullanımda kalmaz), yeni oturum kimliği cookie olarak verilir, seçili firma sıfırlanır; mutlak oturum süresi ilk girişten saymaya devam eder.
İstek: `{ "tenantId": "<uuid>" }`
Yanıt: `204` (gövde yok, token dönmez)
Hatalar: `401` (oturum yok; veya yeni oturum kurulamadı — eski oturum silinir), `403` (CSRF), `404` (backend'den aynen; oturum değişmez), `415`, `422`, `503` (aynı oturumda token yenileme sürüyor, `Retry-After: 1`)

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
| `TENANT_CONTEXT_MISSING` | 500 | Sorgu tenant bağlamı olmadan çalıştırıldı (geliştirici hatası) |
| `TENANT_VIOLATION` | 500 | Sorgu başka tenant'ın verisine dokunmaya çalıştı (geliştirici hatası) |
