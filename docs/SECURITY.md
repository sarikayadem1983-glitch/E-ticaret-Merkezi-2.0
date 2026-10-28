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

Mevcut katmanlar: argon2id şifre hash'i, bilinmeyen email'de sahte hash doğrulaması (yanıt süresi kullanıcı varlığını ele vermez), refresh token rotation ve tekrar kullanımda tüm oturumların kapatılması, başarısız girişlerin Audit Log'a yazılması.

### Hız sınırlama (rate limiting)

Sayaçlar Redis'te tutulur (`rl:` önekli anahtarlar). Her kontrol tek bir atomik Lua script'idir ve Redis saatini kullanır, bu yüzden birden fazla uygulama örneğinde de doğru çalışır. Kod: `backend/src/rate-limit/`, kurallar: `backend/src/auth/auth-rate-limit.service.ts`.

| Uç nokta | Kural | Varsayılan |
|---|---|---|
| `POST /auth/login` | IP başına tüm denemeler (credential stuffing) | 15 dk'da 30 |
| `POST /auth/login` | Hesap + IP başına kademeli bekleme | 5 serbest deneme, sonra 30 sn'den başlayıp her denemede ikiye katlanan bekleme (en fazla 15 dk). Son denemeden 1 saat sonra sıfırlanır. |
| `POST /auth/login` | Hesap başına (tüm IP'ler) kademeli bekleme | 20 serbest deneme, sonra 1 dk'dan başlayıp en fazla 15 dk. Güvenilen IP'ler muaf. |
| `POST /auth/register` | IP başına | saatte 5 |
| `POST /auth/refresh` | IP başına | dakikada 30 |

- **Kalıcı kilitleme yok.** Tüm engeller geçicidir ve süreleri sınırlıdır.
- **Hesap kilitleme saldırısına karşı:** Hesap + IP sınırında saldırgan yalnızca kendi IP'sini yavaşlatır. Hesap genelindeki sınır, sahibin son 30 gün içinde başarıyla giriş yaptığı IP'lere uygulanmaz. Başarılı giriş, o IP'nin sayacını ve hesap genelindeki sayacı sıfırlar.
- **Deneme önce sayılır:** Şifre kontrolünden önce sayaç artırılır, başarılı girişte geri alınır. Paralel istekler sınırı aşamaz. Engellenen istek sayacı ve bekleme süresini uzatmaz.
- **Kullanıcı varlığı açığa çıkmaz:** Anahtarlar yalnızca gönderilen email'e ve IP'ye bağlıdır, hesabın var olup olmamasına bağlı değildir. Kayıtlı ve kayıtsız email aynı 401 ve 429 yanıtlarını alır. Redis'te email değil SHA-256 özeti tutulur.
- **İstemci IP'si:** `req.ip` kullanılır. `X-Forwarded-For` yalnızca `TRUST_PROXY` ile tanımlı proxy'lerden kabul edilir (bkz. bölüm 2). IPv6 adresleri /64 bloğu olarak gruplanır, böylece adres değiştirerek sınır aşılamaz.
- **Yanıt:** `429 TOO_MANY_REQUESTS` ve saniye cinsinden `Retry-After` başlığı. Gövde standart hata formatındadır.

### Redis erişilemezse (fail-closed)

`login`, `register` ve `refresh`, `503 SERVICE_UNAVAILABLE` ve `Retry-After: 5` döner. İstek veritabanına ve argon2'ye ulaşmaz.

- **Neden kapalı:** Açık bırakılırsa Redis kesintisi sınırsız şifre denemesine izin verir. Ayrıca CPU yoğun argon2 doğrulaması bir DoS yolu olur.
- **Bedeli:** Kesinti süresince yeni giriş yapılamaz. Mevcut access token'lar geçerlilik süresi (15 dk) boyunca çalışmaya devam eder.
- **Diğer uç noktalar:** Rate limiting kullanmadıkları için etkilenmez.
- **Hızlı hata:** Redis istemcisi komut kuyruğu tutmaz ve 1 sn zaman aşımı kullanır. Böylece istekler beklemeden hata alır. İstemci arka planda yeniden bağlanmayı dener.

Production'da Redis yüksek erişilebilirlik (replika + otomatik failover) ile çalıştırılmalı ve izlenmelidir.

## 4. Canlıya çıkış öncesi kontrol listesi

Production'a çıkmadan önce her madde tamamlanmış ve doğrulanmış olmalıdır.

- [ ] **Redis yedekliliği:** Rate limiting Redis'e bağlıdır ve Redis kesintisinde giriş kapanır (fail-closed, bkz. §3). Replika + otomatik failover (ör. Redis Sentinel veya yönetilen Redis) kurulmalı, erişilebilirlik izlenmeli ve alarm tanımlanmalı.
- [ ] **CAPTCHA:** Kayıt ve tekrarlanan başarısız girişlerden sonra login için CAPTCHA (ör. Cloudflare Turnstile, hCaptcha) eklenmeli.
- [ ] **Sızmış şifre kontrolü:** Kayıt ve şifre değişikliğinde şifre, sızmış şifre listelerine karşı kontrol edilmeli (ör. HIBP Pwned Passwords k-anonymity API). Şifrenin kendisi dışarı gönderilmez.
- [ ] **`TRUST_PROXY`:** Production'daki load balancer / reverse proxy adresleriyle ayarlanmalı. Yanlış ayarda tüm istemciler proxy IP'sini paylaşır ve IP bazlı sınırlar herkesi birlikte engeller. Çıkıştan sonra `req.ip`'nin gerçek istemci IP'si olduğu doğrulanmalı.
- [ ] **Rate limit değerleri:** Mevcut varsayılanlar (§3) korunur. Canlı trafik izlendikten sonra (ör. ortak NAT arkasındaki ofisler) gözden geçirilmeli.
