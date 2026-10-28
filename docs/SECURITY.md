# Güvenlik

Bu doküman uygulamanın güvenlik modelini ve ortam bazlı yapılandırmasını tanımlar. Tenant izolasyonu ve Audit Log tasarımı için bkz. [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Veritabanı rolleri (en az yetki)

Uygulama PostgreSQL'e **superuser ile bağlanmaz**.

| Rol | Kullanım | Yetkiler |
|---|---|---|
| `postgres` (superuser) | Yalnızca bootstrap: rolleri oluşturmak (`database/roles/setup-roles.sql`) | Tümü. Uygulama veya CI bu hesabı kullanmaz. |
| `tm_migrator` | `prisma migrate deploy` / `migrate diff` (`MIGRATION_DATABASE_URL`) | `public` şemasının ve tüm nesnelerin sahibi. Superuser değil, rol/veritabanı oluşturamaz. |
| `tm_app` | Çalışan uygulama (`DATABASE_URL`) | `CONNECT`, şemada `USAGE` (CREATE yok). İş tablolarında `SELECT, INSERT, UPDATE, DELETE`. `audit_logs`'ta yalnızca `SELECT, INSERT`. `_prisma_migrations`'a erişim yok. `TRUNCATE`, `REFERENCES`, `TRIGGER` yok. |

- Yeni tablolar `tm_migrator` tarafından oluşturulur. `ALTER DEFAULT PRIVILEGES`, `tm_app`'e otomatik olarak `SELECT, INSERT, UPDATE, DELETE` verir. **Append-only** olması gereken yeni tablolar için migration içinde açıkça `REVOKE UPDATE, DELETE` yazılmalıdır.
- `PUBLIC` rolünden veritabanı ve şema üzerindeki `CREATE`/`TEMP` yetkileri alınır.
- Uygulama açılışta bağlandığı rolü kontrol eder. Rol superuser veya `BYPASSRLS` ise production'da **başlamaz**, diğer ortamlarda uyarı loglar.

### Audit Log değiştirilemezliği (katmanlar)

1. API'de yazma endpoint'i yoktur.
2. Prisma eklentisi `AuditLog` üzerinde update/delete/upsert'i reddeder.
3. `tm_app`'in `audit_logs` üzerinde `UPDATE`, `DELETE`, `TRUNCATE` yetkisi yoktur.
4. Trigger `UPDATE`, `DELETE`, `TRUNCATE`'i reddeder. Trigger'ı yalnızca tablo sahibi (`tm_migrator`) kapatabilir.
5. Purge kapısı (`app.allow_audit_purge = 'on'`) yalnızca tablo sahibi rolünün oturumunda geçerlidir. `tm_app` bu ayarı yapsa da silemez.

### Kurulum

Yeni Docker volume'unda roller otomatik oluşturulur (`docker/postgres/init/10-roles.sh`). Mevcut bir veritabanında bir kez çalıştırın (veri kaybı yok; nesnelerin sahibi `tm_migrator` olur):

```bash
sh docker/postgres/setup-roles.sh
```

Script tekrar çalıştırılabilir (idempotent). Şifre değiştirmek için `.env`'deki değeri güncelleyip yeniden çalıştırın.

### Production bağlantı bilgileri

- `DATABASE_URL` ve `MIGRATION_DATABASE_URL` ayrı gizli değerlerdir. Bir secret manager (ör. AWS Secrets Manager, GCP Secret Manager, Vault, Kubernetes Secret) ile ortam değişkeni olarak verilir. Repoya, imaja veya loglara yazılmaz.
- Çalışan uygulamaya **yalnızca** `DATABASE_URL` verilir. `MIGRATION_DATABASE_URL` yalnızca deploy/migration işine verilir.
- Bağlantı TLS ile yapılır: `?sslmode=verify-full` (sertifika doğrulamalı).
- Şifreler en az 32 karakter rastgele üretilir ve düzenli döndürülür.
- Yönetilen PostgreSQL'de `postgres`/admin hesabı uygulamaya verilmez.

## 2. HTTP katmanı

Ayarlar açılışta `backend/src/config/security.config.ts` ile okunur ve doğrulanır. Geçersiz değer uygulamayı **başlatmaz**. Pipeline `setup-app.ts` içindedir; `main.ts` ve e2e testleri aynı pipeline'ı kullanır.

| Değişken | Varsayılan | Kural |
|---|---|---|
| `CORS_ORIGINS` | `FRONTEND_URL` | Virgülle ayrılmış tam origin listesi (yol veya sondaki `/` yok). Joker (`*`) yasak. Production'da yalnızca `https`. Boşsa CORS kapalı. |
| `TRUST_PROXY` | boş (güvenme) | Proxy IP/CIDR listesi veya `loopback`, `linklocal`, `uniquelocal`. `true` ve hop sayısı reddedilir: istemcinin gönderdiği `X-Forwarded-For`'a güvenmeye yol açar. |
| `ENFORCE_HTTPS` | production'da `true` | HTTPS olmayan istek `426 HTTPS_REQUIRED` alır. `/api/v1/health` muaftır (load balancer probe'u). Production'da kapatılamaz. |
| `BODY_LIMIT` | `100kb` | JSON ve urlencoded gövde sınırı, `1b`–`10mb`. Aşılırsa `413 PAYLOAD_TOO_LARGE`. |

- **Güvenlik başlıkları (helmet):** API JSON döndürür, hiçbir şey render veya frame edilmez: `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. `Cross-Origin-Resource-Policy: same-site`. HSTS yalnızca production'da (`max-age=31536000; includeSubDomains`).
- **CORS:** Yalnızca `GET, POST, PUT, PATCH, DELETE`; başlıklar `Authorization, Content-Type`. Cookie/credential yok (token `Authorization` başlığında). Preflight önbelleği 600 sn.
- **Body parser:** Nest'in varsayılanı kapalı (`bodyParser: false`). Boyut, bozuk JSON ve charset hataları standart `{ error: { code, message, details } }` formatında döner, iç mesaj sızmaz.
- **Hata yanıtları:** Bilinmeyen hatalar loglanır, istemciye `INTERNAL_ERROR` / `Sunucu hatası` döner. Production'da 5xx yanıtları iç hata kodu (ör. tenant hataları) da taşımaz.
- **Kapanış:** `enableShutdownHooks` ile SIGTERM'de bağlantılar düzgün kapanır.

## 3. Kimlik doğrulama koruması

> Bu aşamada geliştiriliyor.
