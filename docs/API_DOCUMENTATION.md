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
Hatalar: `409` email veya slug kullanımda, `422` doğrulama hatası

### POST /api/v1/auth/login
Açıklama: Email + şifre ile giriş.
Yetki: Yok (herkese açık)
İstek: `{ "email": "a@b.com", "password": "..." }`
Yanıt: `200` register ile aynı
Hatalar: `401` `INVALID_CREDENTIALS` (kullanıcı yok, şifre yanlış, kullanıcı veya tenant pasif — ayrım yapılmaz), `422`

### POST /api/v1/auth/refresh
Açıklama: Refresh token'ı döndürür (rotation). Eski token geçersiz olur.
Yetki: Yok (refresh token gövdede)
İstek: `{ "refreshToken": "..." }`
Yanıt: `200` register ile aynı
Hatalar: `401` `INVALID_REFRESH_TOKEN` (yok, süresi dolmuş, iptal edilmiş — iptal edilmiş token kullanılırsa kullanıcının tüm oturumları kapatılır), `422`

### POST /api/v1/auth/logout
Açıklama: Verilen refresh token'ı iptal eder.
Yetki: Bearer token
İstek: `{ "refreshToken": "..." }`
Yanıt: `204`
Hatalar: `401`, `422`

### GET /api/v1/auth/me
Açıklama: Oturumdaki kullanıcı.
Yetki: Bearer token
Yanıt: `200` `{ "data": { "id": "...", "tenantId": "...", "name": "...", "email": "...", "permissions": ["*"] } }`
Hatalar: `401`

### Genel hata kodları
| Kod | HTTP | Anlam |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Girdi doğrulanamadı; `details` alan hatalarını içerir |
| `UNAUTHORIZED` | 401 | Token yok veya geçersiz |
| `FORBIDDEN` | 403 | İzin yok |
| `CONFLICT` | 409 | Tekil alan çakışması |
| `TENANT_CONTEXT_MISSING` | 500 | Sorgu tenant bağlamı olmadan çalıştırıldı (geliştirici hatası) |
| `TENANT_VIOLATION` | 500 | Sorgu başka tenant'ın verisine dokunmaya çalıştı (geliştirici hatası) |
