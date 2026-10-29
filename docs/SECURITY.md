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

### Access token sürümü (`ver`) ve eski token'lar

- Her yeni access token (login, kayıt, refresh) `ver` claim'i taşır: üyeliğin `auth_version`'ı (ilk değer 1).
- Bu değişiklikten önce üretilmiş token'larda `ver` yoktur; doğrulamada **0** kabul edilir (çökme yok). Tam sayı olmayan `ver` içeren token reddedilir.
- Refresh, üyelik aktif değilse veya tenant pasifse reddedilir.

### Her istekte oturum kontrolü (`auth_version`)

- `JwtAuthGuard` imzayı doğruladıktan sonra her istekte üyeliği veritabanından okur (tek sorgu: `tenant_memberships` birincil anahtarı + `tenants` join, `MembershipsRepository.sessionState`). Önbellek yoktur; değişiklik bir sonraki istekte etkili olur.
  - Üyelik yok, pasif veya tenant pasif/silinmiş → `401 SESSION_REVOKED`.
  - `ver` ≠ üyeliğin `auth_version`'ı → `401 TOKEN_STALE`. Üyelik öncesi token'lar (`ver` yok → 0) da `TOKEN_STALE` olur; refresh güncel `ver` ile yeni token verir.
  - `sub`/`tid` UUID değilse token geçersizdir (`401 UNAUTHORIZED`). Veritabanı hatasında istek reddedilir (fail-closed, `500`).
- `MembershipsRepository.bumpAuthVersion(tx, tenantId, userId)` üyeliğin tüm access token'larını geçersiz kılar (refresh token'lara dokunmaz). Rol/firma ataması değişikliği ve pasife alma bunu çağırır (pasife alma ayrıca refresh token'ları iptal eder).
- **Mağaza değiştirme** eski mağazadaki üyeliğin `auth_version`'ını artırır: eski mağazanın access token'ı hemen `TOKEN_STALE` olur ve refresh token'ı iptal edildiği için geri dönülemez. Kullanıcının o mağazadaki diğer cihazları bir kez refresh yapıp devam eder.
- **Ölçülen maliyet** (yerel Docker PostgreSQL 16, 2026-10-29): kontrol sorgusu p50 0,93 ms, p95 1,4–1,6 ms, p99 2–3,5 ms (3 × 2000 çağrı); `GET /auth/me` toplam p50 ≈ 7,1 ms. Uzak veritabanında bu süreye ağ gecikmesi eklenir.

### Login ve başarısız giriş

- Login'de aktif üyeliği olmayan kullanıcı, bilinmeyen e-postayla birebir aynı yanıtı alır (`401 Email veya şifre hatalı`). Bilinmeyen e-postada da üyelik sorgusu çalışır, böylece sorgu sırası aynıdır.
- **Başarısız giriş audit'i:** e-posta bir kullanıcıya aitse `LOGIN_FAILED` ilgili tenant'a yazılır: kullanılabilir mağaza varsa o tenant'a, yoksa `last_tenant_id`'nin üyeliğine, o da yoksa durumu en son değişen üyeliğe (tek satır). `after` yalnızca neden kodudur: `invalid_password`, `membership_inactive`, `tenant_inactive`. Şifre, e-posta, hash veya token yazılmaz. Kullanılabilir mağaza yoksa kayıt arka planda yazılır (yanıt süresi hesabın varlığını ele vermez). Bilinmeyen e-posta audit'e yazılmaz.
- Audit yazımı başarısız olursa giriş yanıtı değişmez (yine genel `401`, `500` yok); hata kimlik bilgisi içermeden loglanır.

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
- **Açılışta hazır olma:** uygulama açılışta Redis'in ilk bağlantısını (en fazla 2 sn) bekler; böylece ilk istekler bağlantı kurulmadan gönderilip `503` almaz. Redis açılışta yoksa uygulama yine açılır, hata loglanır ve kimlik doğrulama uçları Redis gelene kadar `503` döner.
- **Hızlı hata:** Redis istemcisi komut kuyruğu tutmaz ve 1 sn zaman aşımı kullanır. Böylece istekler beklemeden hata alır. İstemci arka planda yeniden bağlanmayı dener.

Production'da Redis yüksek erişilebilirlik (replika + otomatik failover) ile çalıştırılmalı ve izlenmelidir.

## 4. Canlıya çıkış öncesi kontrol listesi

Production'a çıkmadan önce her madde tamamlanmış ve doğrulanmış olmalıdır.

- [ ] **Redis yedekliliği:** Rate limiting Redis'e bağlıdır ve Redis kesintisinde giriş kapanır (fail-closed, bkz. §3). Replika + otomatik failover (ör. Redis Sentinel veya yönetilen Redis) kurulmalı, erişilebilirlik izlenmeli ve alarm tanımlanmalı.
- [ ] **CAPTCHA:** Kayıt ve tekrarlanan başarısız girişlerden sonra login için CAPTCHA (ör. Cloudflare Turnstile, hCaptcha) eklenmeli.
- [ ] **Sızmış şifre kontrolü:** Kayıt ve şifre değişikliğinde şifre, sızmış şifre listelerine karşı kontrol edilmeli (ör. HIBP Pwned Passwords k-anonymity API). Şifrenin kendisi dışarı gönderilmez.
- [ ] **`TRUST_PROXY`:** Production'daki load balancer / reverse proxy adresleriyle ayarlanmalı. Yanlış ayarda tüm istemciler proxy IP'sini paylaşır ve IP bazlı sınırlar herkesi birlikte engeller. Çıkıştan sonra `req.ip`'nin gerçek istemci IP'si olduğu doğrulanmalı.
- [ ] **BFF Redis'i:** Oturumlar Redis'te tutulur; Redis kesintisinde kimse giriş yapamaz ve açık oturumlar çalışmaz. Rate limiting ile aynı yedeklilik gerekir (§5).
- [ ] **HTTPS ve sertifika:** Next.js önünde TLS sonlandıran load balancer/proxy. `APP_ORIGIN=https://...`, `BFF_TRUST_PROXY` o proxy'nin adresi, backend `TRUST_PROXY` Next.js sunucularının adresi.
- [ ] **`SESSION_SECRET`:** Secret manager'dan verilir, en az 32 karakter. Değiştirildiğinde tüm oturumlar düşer (kullanıcılar yeniden giriş yapar).
- [ ] **Backend'e ağ erişimi:** Backend yalnızca BFF sunucularından erişilebilir olmalı (internal network / güvenlik grubu); internete açık olmamalı.
- [ ] **Rate limit değerleri:** Mevcut varsayılanlar (§3) korunur. Canlı trafik izlendikten sonra (ör. ortak NAT arkasındaki ofisler) gözden geçirilmeli.
- [ ] **Nonce tabanlı CSP:** `script-src 'unsafe-inline'` yerine `proxy.ts`'te istek başına nonce üretilmeli (§5 Güvenlik başlıkları).

## 5. Frontend (BFF) oturum güvenliği

Tarayıcı backend'e doğrudan erişmez. Tüm API çağrıları Next.js sunucusundaki BFF üzerinden yapılır. Kod: `frontend/src/server/`, `frontend/src/app/api/`, `frontend/server.mjs`.

### Oturum

- **Tarayıcıda yalnızca oturum kimliği:** 256 bit rastgele değer, cookie `__Host-tm_sid` (production) / `tm_sid` (geliştirme). `HttpOnly`, production'da `Secure`, `SameSite=Lax`, `Path=/`. `__Host-` öneki tarayıcıyı `Secure`, `Path=/` ve `Domain` olmamasına zorlar; alt alan adları cookie'yi yazamaz.
- **Token'lar sunucuda:** Access ve refresh token BFF'in Redis deposunda (`bff:sess:<sha256(oturum kimliği)>`) tutulur. Değer AES-256-GCM ile şifrelenir (anahtar `SESSION_SECRET`'tan HKDF ile türetilir) ve anahtarına bağlanır: Redis dökümü token vermez, değer başka anahtara taşınırsa çözülmez. `localStorage`/`sessionStorage` kullanılmaz; hiçbir yanıt tarayıcıya token döndürmez.
- **Süreler:** 2 saat işlem yapılmazsa (kayan süre) veya girişten 12 saat sonra (mutlak süre) oturum biter. Mutlak süre, refresh token'ın 7 günlük ömründen bağımsız olarak uygulanır.
- **Session fixation:** Giriş ve kayıtta her zaman yeni oturum kimliği üretilir; tarayıcının önceden taşıdığı kimlik silinir.
- **Mağaza değiştirme:** `POST /api/session/tenant` (CSRF korumalı). Backend mevcut refresh token'ı iptal eder ve hedef üyelik için yeni çift üretir; `tid`/`perms`/`ver` yalnızca hedef üyelikten gelir, önceki mağazanın yetkisi taşınmaz. BFF eski oturum kimliğini siler, yeni kimlik verir (session fixation), seçili firmayı sıfırlar; mutlak süre ilk girişten saymaya devam eder. Hedefte aktif üyelik yoksa, üyelik/mağaza pasifse veya mağaza yoksa `404`: token üretilmez, mevcut oturum aynen kalır. İşlem token yenilemeyle aynı Redis kilidini alır (paralel rotation yok). Her iki mağazaya `TENANT_SWITCH` audit kaydı (token içermez). Arayüz geçişten sonra tam sayfa yükler.
- **Token rotation:** Access token süresinin dolmasına 30 sn kala BFF backend'den refresh yapar ve yeni token çiftini kaydeder.
- **`TOKEN_STALE` / `SESSION_REVOKED`:** Backend `401 TOKEN_STALE` dönerse BFF (`SessionManager.send`) aynı kilitle bir kez refresh yapar ve isteği bir kez tekrarlar; paralel istekler tek refresh paylaşır. `SESSION_REVOKED`, kodsuz başka bir `401`, başarısız refresh veya tekrar sonrası ikinci `401` → oturum silinir, cookie temizlenir, `401`. Döngü yoktur. (`/api/bff/*`, `GET /api/session`, `PUT /api/session/company`.)
- **Eşzamanlı refresh:** Backend aynı refresh token'ın ikinci kullanımını hırsızlık sayıp kullanıcının tüm oturumlarını kapatır. Bu yüzden bir oturum için aynı anda tek refresh yapılır: Redis kilidi (`SET NX PX`, sahibine özel serbest bırakma) tüm BFF örneklerinde geçerlidir. Diğer istekler sonucu en fazla 5 sn bekler, sonra `503`.
- **Refresh reddedilirse** (iptal, süre dolumu, tekrar kullanım) oturum silinir, kullanıcı girişe yönlendirilir. Backend erişilemezse oturum korunur, `503` döner.
- **Çıkış:** Backend'de refresh token iptal edilir, Redis'teki oturum silinir, cookie temizlenir. Backend'e ulaşılamasa da yerel temizlik yapılır.
- **Redis erişilemezse** giriş, kayıt ve API istekleri `503` döner; giriş/kayıt backend'e hiç gitmez (fail-closed, §3 ile aynı yaklaşım).

### CSRF

`SameSite=Lax` cookie'ye ek olarak, durum değiştiren her istekte (`POST/PUT/PATCH/DELETE`):

1. `Origin` başlığı `APP_ORIGIN` ile birebir aynı olmalı (eksik veya farklıysa `403`).
2. `Sec-Fetch-Site` gönderilmişse `same-origin` olmalı.
3. `X-TM-CSRF: 1` başlığı olmalı. Başka sitedeki form bu başlığı ekleyemez; başka origin'den `fetch` CORS preflight ister ve BFF CORS izni vermez.

Gövde yalnızca `application/json` ve en fazla 64 KB kabul edilir.

### Açık proxy koruması

`/api/bff/*` yalnızca izin listesindeki (`frontend/src/server/bff-routes.ts`) metot + yol + sorgu parametrelerini iletir. Listede olmayan endpoint (`audit-logs`, `auth/refresh` vb.), farklı metot, UUID olmayan kimlik, `..`, `/`, `%`, ters bölü içeren yol parçaları ve bilinmeyen sorgu parametreleri reddedilir. Hedef adres her zaman `BACKEND_URL`'dir; yönlendirme izlenmez. Backend'e yalnızca JSON gövde, `Authorization`, `User-Agent` ve BFF'in belirlediği `X-Forwarded-For` gider; tarayıcının cookie ve diğer başlıkları gitmez.

### Gerçek istemci IP'si

Next.js, istemcinin gönderdiği `X-Forwarded-For`'u değiştirmeden geçirir (doğrulandı). Bu yüzden `frontend/server.mjs`, Next.js'ten önce:

- İstemcinin gönderdiği `X-Forwarded-*`, `X-Real-IP`, `Forwarded` başlıklarını siler.
- IP'yi soket adresinden ve yalnızca `BFF_TRUST_PROXY` listesindeki proxy'lerin `X-Forwarded-For` zincirinden belirler (`proxy-addr`; `true` ve hop sayısı reddedilir).
- Sonucu yalnızca BFF'in okuduğu iç başlığa yazar. BFF bu IP'yi backend'e `X-Forwarded-For` olarak iletir; backend `TRUST_PROXY` ile yalnızca BFF'ten gelen bu başlığa güvenir.

| Ortam | `BFF_TRUST_PROXY` | Backend `TRUST_PROXY` |
|---|---|---|
| Geliştirme (tek makine) | boş | `loopback` |
| Production | load balancer IP/CIDR | Next.js sunucularının IP/CIDR'ı |

### HTTPS

Production'da (`NODE_ENV=production`) HTTP istekleri reddedilir: `GET/HEAD` → `308` HTTPS'e yönlendirme, diğerleri → `426 HTTPS_REQUIRED`. Protokol yalnızca soketten veya güvenilen proxy'nin `X-Forwarded-Proto`'sundan alınır. HSTS (`max-age=31536000; includeSubDomains`) gönderilir. `APP_ORIGIN` production'da `https` olmak zorundadır.

### Sayfa koruması

`frontend/src/proxy.ts` (Next.js 16'da middleware'in yeni adı) oturum cookie'si olmayan kullanıcıyı korumalı sayfalardan `/login`'e yönlendirir. Bu yalnızca kullanıcı deneyimi içindir: asıl kontrol her veri isteğinde BFF ve backend'dedir. Girişten sonraki `?next=` yönlendirmesi yalnızca uygulama içi yolları kabul eder (açık yönlendirme yok).

### Güvenlik başlıkları

`frontend/next.config.ts` tüm sayfa ve BFF yanıtlarına ekler:

- `Content-Security-Policy`: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'`; production'da `upgrade-insecure-requests`. Dış kaynak (CDN, font, analitik) yok.
- `X-Frame-Options: DENY` (eski tarayıcılar için; `frame-ancestors` ile aynı karar).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (kamera, mikrofon, konum, ödeme kapalı), `Cross-Origin-Opener-Policy: same-origin`. `X-Powered-By` gönderilmez.

Bilinen sınır: Next.js satır içi başlatma script'leri kullandığı için `script-src` şu an `'unsafe-inline'` içerir (geliştirmede ek olarak `'unsafe-eval'` ve HMR için `ws:`). Canlıya çıkmadan önce `proxy.ts`'te istek başına nonce üreten CSP'ye geçilmeli (§4 kontrol listesi).
