# Mimari

## Genel Yaklaşım

Ticaret Merkezi 2.0, ayrı backend (API) ve frontend (yönetim paneli) uygulamalarından oluşur. Backend **modüler monolit** olarak tasarlanır: tek uygulama, modüller arası net sınırlar. İleride gerekirse modüller ayrı servislere bölünebilir.

```
[Frontend Panel] --HTTP/JSON--> [Backend API] --> [Veritabanı]
                                     |
                                     +--> [Kuyruk / Worker] --> [Pazaryeri API'leri]
                                     +--> [Önbellek]
```

## Teknoloji Yığını

| Katman | Teknoloji | Durum |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript | Kabul |
| UI | Tailwind CSS, Shadcn UI | Kabul |
| Sunucu durumu | TanStack Query (React Query) | Kabul |
| İstemci durumu | Zustand | Kabul |
| Backend | NestJS, TypeScript | Kabul |
| ORM | Prisma | Kabul |
| Veritabanı | PostgreSQL | Kabul |
| Önbellek / Kuyruk | Redis | Kabul |
| Container | Docker, Docker Compose | Kabul |
| Kimlik doğrulama | JWT + Refresh Token, RBAC | Kabul |

## Mimari Kararlar

1. **Modüler monolit ile başlangıç.** Her modül bir NestJS modülüdür. Modüller arası iletişim yalnızca dışa açılan servisler ve domain event'leri üzerinden olur. Bu sınırlar ileride modülün ayrı mikroservise taşınmasını sağlar.
2. **Multi-tenant SaaS.** Her kiracı (tenant) bir mağaza/şirkettir. Tenant'a ait her tabloda `tenant_id` bulunur. Tenant kimliği JWT'den okunur ve tüm sorgulara zorunlu filtre olarak uygulanır (Prisma middleware/extension).
3. **AI Engine bağımsız modül.** Diğer modüllerin verisine doğrudan erişmez; event ve okuma API'leri üzerinden beslenir. Ağır işler kuyrukta (Redis) arka planda çalışır. İlk ayrılacak servis adayıdır.
4. **Company (Firma) tenant altında işletmedir.** Tenant müşteri hesabıdır (abonelik, kullanıcılar, faturalama). Company ise o hesabın altında faaliyet gösteren tüzel veya gerçek kişi işletmedir. Ayrıntılar: [Company Modeli](#company-firma-modeli). *Durum: karar verildi, geliştirme ayrı aşamada.*
5. **Audit Log değiştirilemez ve merkezidir.** Tüm modüller işlem geçmişini tek `audit` modülü üzerinden yazar. Ayrıntılar: [Audit Log](#audit-log).

## Tenant İzolasyonu (zorunlu)

Tenant filtresi geliştiriciye bırakılmaz; Prisma seviyesinde zorunludur ve **fail-closed** çalışır.

- Her HTTP isteği boş bir tenant bağlamıyla (`AsyncLocalStorage`) başlar. JWT guard token'ı doğrulayınca bağlama `tenantId` yazar.
- Uygulamanın kullandığı tek Prisma istemcisi tenant eklentisiyle sarılıdır. Bağlamda tenant yoksa **hiçbir sorgu çalışmaz**, `TENANT_CONTEXT_MISSING` hatası döner (500 — geliştirici hatası).
- Eklenti her model işlemine `tenant_id = <bağlamdaki tenant>` koşulunu ekler, `create` verisine `tenantId` yazar. Sorguda veya yazılan veride (iç içe yazmalar dahil) farklı bir `tenantId` varsa işlem reddedilir. `Tenant` modeli `id` ile kısıtlanır.
- Ham SQL (`$queryRaw`, `$executeRaw`) tenant bağlamında yasaktır.
- **Global modeller** (`GLOBAL_MODELS`, bugün yalnızca `User`) tenant ile filtrelenmez ve **yalnızca system context'te** kullanılabilir; tenant bağlamında `User` sorgusu `TenantViolationError` ile reddedilir. İç içe yazmalar da (`data: { user: { update | create | upsert | connectOrCreate | delete | ... } }`, `acceptedBy` dahil) reddedilir; yalnızca var olan kullanıcıya `connect` ve `include/select` ile okuma serbesttir. Tenant içinden kullanıcı bilgisi `TenantMembership` üzerinden (`select: { user: { select: { id, name, email } } }`) okunur.
- Veritabanı seviyesinde ikinci güvence: tenant'a ait tablolar arası yabancı anahtarlar `(tenant_id, x_id)` → `(tenant_id, id)` biçiminde composite'tir; farklı tenant'ın kaydına ilişki kurulamaz.
- Tenant'tan önce çalışması gereken işlemler (giriş, kayıt, refresh token çözümü, health check) yalnızca `TenantContext.runAsSystem()` içinde çalışır. Bu fonksiyonu kullanabilecek dosyalar bir testte izin listesiyle sabitlenmiştir; yeni kullanım test kırar ve code review gerektirir.
- HTTP dışı işler (kuyruk worker'ları) `TenantContext.run(tenantId, fn)` ile çalışır. Kuyruk işleri system context'te hiç çalışmaz (bkz. [Kuyruk](#kuyruk-arka-plan-işleri)).

## Kuyruk (arka plan işleri)

`backend/src/queue/` (global `QueueModule`, `QueueService`). BullMQ 6.3.15, Redis üzerinde. INT-02 (pazaryeri senkron motoru), içe aktarma, rapor ve `ai-engine` işleri bunu kullanır.

- **Tip güvenli iş tanımı:** `defineJob<P>({ name, attempts?, backoffMs?, concurrency?, parse? })`. Her tanım kendi BullMQ kuyruğudur (anahtarlar `queue:<name>:…`). Sahibi olan modül `onModuleInit`'te `queueService.register(def, handler)` çağırır; handler `(payload, { tenantId, jobId, attempt })` alır.
- **Tenant bağlamı:** `enqueue(def, payload, { idempotencyKey })` tenant'ı **çağıranın** `TenantContext`'inden alır ve işe yazar (`{ tenantId, payload }`). Tenant bağlamı yoksa veya system context'teyse `TENANT_CONTEXT_MISSING` ile reddedilir; başka tenant adına iş kuyruğa alınamaz. Worker işi `TenantContext.run(tenantId)` içinde çalıştırır: Prisma sorguları yalnızca o tenant'ın satırlarını görür. `tenantId` yoksa, UUID değilse, tenant bilinmiyorsa veya pasifse iş **çalıştırılmaz** (`INVALID_JOB_TENANT`), tekrar denenmez ve ölü kuyruğa düşer. Tenant kontrolü `TenantsService.isActive` ile tenant'ın kendi bağlamında yapılır (`runAsSystem` kullanılmaz).
- **Retry/backoff:** varsayılan 5 deneme, üstel bekleme `backoffMs · 2^(deneme-1)` (varsayılan 1 sn). `parse` hatası (`INVALID_JOB_PAYLOAD`) ve tenant reddi tekrar denenmez.
- **Ölü kuyruk:** tüm denemeleri biten veya reddedilen iş BullMQ'nun `failed` kümesinde 30 gün saklanır. `deadLetters(def, { limit, cursor })` ve `retryDeadLetter(def, id)` yalnızca çağıranın tenant'ının işlerini görür/yeniden kuyruğa alır. `deadLetters` failed kümesini 200'lük partilerle okur ve çağrı başına en fazla 2000 iş tarar (başka tenant'ın toplu hataları yükü büyütmez); sonuç `{ items, nextCursor }` döner, `nextCursor` ile devam edilir (sayfa sınırı en fazla 100). Log satırı yalnızca kuyruk, iş kimliği, tenant kimliği (geçerli UUID ise), deneme sayısı ve hata **kodunu** içerir; payload ve hata mesajı loglanmaz.
- **Handler hataları (handler yazarları için):** runner handler'ın fırlattığı hatayı `JOB_FAILED:<kod>` ile değiştirir. Kod, hatanın `code` alanı (ör. `ETIMEDOUT`, yalnızca `A-Z0-9_`) ya da sınıf adıdır; mesaj ve stack Redis'e **yazılmaz** (`stackTraceLimit: 0`). Ret kodları: `INVALID_JOB_TENANT`, `INVALID_JOB_PAYLOAD`. Ayrıntılı tanı gerekiyorsa handler kendi logunu gizli bilgi içermeden yazar; hata sınıfına anlamlı bir `code` vermek ölü kuyrukta ayırt etmeyi sağlar. Handler `UnrecoverableError` fırlatırsa iş tekrar denenmez (`JOB_FAILED:UNRECOVERABLE`).
- **Idempotency:** `idempotencyKey` zorunludur. İş kimliği `sha256(tanım, tenant, anahtar)`; aynı anahtar iş bekliyor/çalışıyorken, tamamlandıktan sonra 7 gün ve başarısız olduktan sonra 30 gün boyunca ikinci kez çalışmaz (`{ duplicate: true }` döner). Aynı anahtar farklı tenant'ta ayrı iştir. Saklama süresinden sonra aynı anahtar yeniden çalışabilir; daha uzun süreli garanti gereken iş (ör. sipariş içe alma) ayrıca veritabanında tekil kısıt kullanmalıdır.
- **Redis bağlantısı:** üretici bağlantısı `rate-limit/redis.provider.ts` ile aynı ayarları kullanır (offline queue yok, 1 sn komut zaman aşımı, açılışta en fazla 2 sn bekleme). Redis kapalıyken `enqueue` beklemeden (bağlantı yoksa hemen, en geç 2 sn'de) `QueueUnavailableError` (`QUEUE_UNAVAILABLE`) fırlatır; çağıran bunu `503` veya kendi yeniden deneme mantığına çevirir. Worker bağlantısı BullMQ gereği `maxRetriesPerRequest: null` kullanır: Redis kapalıyken worker bekler ve yeniden bağlanır, işler Redis'te durduğu için kaybolmaz. Redis verisi kaybolursa (kalıcılık kapalı) kuyruktaki işler de kaybolur: production'da AOF kalıcılığı açık olmalıdır.
- **Sağlık:** `GET /health` yanıtında `queue: "up" | "down"`. Kuyruk kapalıyken yanıt `200` kalır (API çalışır), `503` yalnızca veritabanı içindir.
- **Kapanış:** `enableShutdownHooks` ile `onApplicationShutdown`: yeni iş kabul edilmez, çalışan işler en fazla `QUEUE_SHUTDOWN_TIMEOUT_MS` (varsayılan 10 sn) beklenir; süre dolarsa veya Redis kapalıysa worker zorla kapatılır, bağlantılar kesilir. Zorla öldürülen işin yarım kalması BullMQ tarafından "stalled" olarak algılanır ve iş tekrar çalışır; bu yüzden handler'lar idempotent yazılmalıdır.
- **Ölçek:** `QUEUE_WORKERS=false` worker başlatmaz (yalnızca iş kuyruğa alan API örneği).
- **Payload kuralı:** payload gizli bilgi (token, şifre, pazaryeri kimlik bilgisi) içermez; Redis'te açık metin durur ve ölü kuyrukta saklanır. Handler kimlik bilgisini çalışırken kendi tenant bağlamında okur.

## Company (Firma) Modeli

> Backend uygulandı (`companies` modülü). Kullanıcıya firma atama ekranları sonraki aşamada.

- Bir Tenant birden fazla Company oluşturabilir. Company tenant'a ait bir kayıttır (`tenant_id` zorunlu), tenant izolasyonu aynen uygulanır.
- Her Company'de: ticari unvan, vergi numarası (VKN/TCKN), vergi dairesi, adres ve e-Fatura bilgileri (mükellefiyet, posta kutusu etiketi vb.) bulunur.
- Vergi numarası tenant içinde tekildir: `(tenant_id, tax_number)`.
- Her Company birden fazla pazaryeri mağazasına bağlanabilir (`channels` kayıtları `company_id` taşır).
- Kullanıcılar şirket bazında yetkilendirilebilir: tenant seviyesindeki rollere ek olarak kullanıcı–company–rol ataması yapılır. Company kapsamlı bir endpoint hem izni hem de kullanıcının o company'ye erişimini kontrol eder.
  - İzinler: `companies:read`, `companies:write`. `companies:all` (veya `*`) tenant'ın tüm firmalarına erişim verir; yoksa kullanıcı yalnızca `user_company_roles` ile atandığı firmaları görür.
  - Erişimi olmayan veya başka tenant'a ait firma `404` döner (varlığı açığa çıkmaz). Firma oluşturmak `companies:all` ister: yeni firmanın henüz ataması yoktur.
- Company; e-Fatura, sipariş, stok ve muhasebe modüllerinde referans olarak kullanılacaktır. Bu modüller Company tablosuna doğrudan erişmez, `companies` modülünün servisini kullanır.

## Audit Log

- Tenant bazlı, değiştirilemez işlem geçmişi. Kayıt alanları: işlem türü, modül, varlık türü, kayıt kimliği, işlemi yapan kullanıcı, önceki/sonraki değerler, IP adresi, user agent, zaman.
- İşlem türleri: `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `TOKEN_REUSE_DETECTED`.
- Modüller kaydı `AuditService.record()` ile yazar. Veri değişikliğiyle aynı transaction'a verilirse ikisi birlikte commit/rollback olur.
- İşlemi yapan kullanıcı, IP ve user agent istek bağlamından (`RequestContext`) otomatik alınır.
- **Hassas veri koruması:** kaydedilmeden önce değerler temizlenir. Adı şifre, token, secret, hash, authorization, cookie, API anahtarı, kimlik bilgisi, kart, IBAN içeren alanlar `[REDACTED]` olur. `UPDATE` kayıtlarında yalnızca değişen alanlar saklanır. Derinlik ve boyut sınırlıdır.
- **Değiştirilemezlik:** Prisma eklentisi `audit_logs` üzerinde update/delete/upsert işlemlerini system bağlamında bile reddeder. Veritabanında ayrıca bir trigger `UPDATE` ve `DELETE`'i engeller. API'de yalnızca okuma endpoint'leri vardır.
- **Erişim:** `audit:read` izni gerekir; tenant izolasyonu nedeniyle kullanıcı yalnızca kendi tenant'ının kayıtlarını görür.
- Kimliği bilinmeyen email ile başarısız girişler tenant'a bağlanamadığı için audit log'a yazılmaz.

## Kimlik Doğrulama ve Yetkilendirme

- Kısa ömürlü **access token** (JWT) + uzun ömürlü **refresh token**.
- Refresh token veritabanında hash'lenmiş saklanır, her kullanımda döndürülür (rotation), iptal edilebilir.
- Refresh token opak rastgele değerdir (JWT değildir); veritabanında SHA-256 hash'i tutulur. İptal edilmiş bir token tekrar kullanılırsa kullanıcının tüm refresh token'ları iptal edilir.
- Şifreler Argon2id ile hash'lenir.
- **Kullanıcı ve üyelik modeli:** `users` global kimliktir (tek e-posta, küçük harf, tüm tenant'larda tek hesap). Kişinin bir tenant'taki varlığı `tenant_memberships` satırıdır (`status` active/inactive, `auth_version`); roller (`user_roles`), firma rolleri (`user_company_roles`) ve refresh token'lar üyeliğe bağlıdır. `users.tenant_id` faz 1'de artık okunmaz; `users.is_active` ve `users.deleted_at` login, refresh ve `JwtAuthGuard` tarafından okunur (pasif/silinmiş kullanıcı token alamaz, açık oturumu `SESSION_REVOKED` olur). Faz 2'de yalnızca `users.tenant_id` kaldırılır; `is_active` ve `deleted_at` kalır. Üyelik tablosuna yalnızca `memberships` modülü (`MembershipsRepository`) erişir.
- **Erişim modülü (`access`):** `roles.catalog.ts` sistem rollerinin izinlerinin tek kaynağıdır. `AccessService.tenantPermissions` JWT `perms`'i üretir (auth bunu kullanır). `assertCompanyPermission` kullanıcının **o firmadaki** rolünü her çağrıda veritabanından okur, JWT `perms`'e güvenmez: atama yoksa `404`, izin yoksa `403`. Mağaza rolü (Owner/Admin) tüm firmalarda geçerlidir. `access.rules.ts`: `canGrant` (Owner'ı kimse atamaz, Admin'i yalnızca Owner atar), `assertNotLastOwner` (`409 LAST_OWNER`), `assertNotSelf` (`403 SELF_CHANGE`). Açılışta her canlı tenant için eksik katalog rolü yalnızca loglanır (`SystemRolesCheck`, başlatmayı durdurmaz; `runAsSystem` izin listesinde).
- **Firma erişimi (`companies`):** liste, özet ve tek firma okuması mağaza rolünü veritabanından okur (`seesAllCompanies`): Owner/Admin tüm firmaları, firma rolleri yalnızca atandıkları firmaları görür. `PATCH /companies/:id`, `/activate`, `/deactivate` her istekte `assertCompanyPermission(user, id, 'companies:write')` çağırır; guard bu uç noktalarda yalnızca `companies:read` ister, karar servistedir (atama yok `404`, salt okunur rol `403`). Atama kaldırılınca eski token bir sonraki istekte o firmayı göremez. `GET /auth/me` ekleri: `canManageUsers`, `canWriteAllCompanies` (mağaza rolü), `companyCapabilities: { [companyId]: { canWrite } }` (firma rolleri). Plandan sapma: `access` modülü `companies` tablosunu okumadığı için mağaza rolleri için firma listesi yerine `canWriteAllCompanies` döner.
- **Login:** e-posta global kullanıcıda doğrulanır; aktif tenant'lardaki aktif üyelikler alınır. Üyelik yoksa genel `Email veya şifre hatalı`; birden fazlaysa `last_tenant_id` aktifse o, değilse tenant adına göre ilki seçilir. Access token: `sub`, `tid`, `perms` (o üyeliğin mağaza + firma rollerinin birleşimi), `ver` (üyeliğin `auth_version`'ı).
- **Kayıt:** tek transaction'da tenant, global kullanıcı (`last_tenant_id` = yeni tenant), aktif owner üyeliği, beş sistem rolü (tek `INSERT`, `createManyAndReturn`) ve owner ataması. Şifre hash'i ve refresh token üretimi transaction dışında yapılır; transaction 8 sorgudur (ölçülen en kötü 0,72 sn); `timeout: 10_000` yalnızca güvenlik sınırıdır.
- **Sistem rolleri:** `backend/src/access/roles.catalog.ts` izinlerin tek kaynağıdır. `key`'i olan rollerin izinleri katalogdan, `key`'i olmayan (eski/özel) rollerin izinleri `roles.permissions` kolonundan okunur.
- **Davetler (`invitations`):** token 32 bayt rastgele, yalnızca SHA-256'sı saklanır, tek kullanımlık ve süreli (`INVITATION_TTL_HOURS`, varsayılan 168). Davet beklerken hiçbir atama yoktur; kabul tek transaction'da yetkiyi yeniden doğrular. Global hesap işlemleri (`users`) `auth` modülünün `AccountsService`'iyle yapılır (sistem bağlamı, `runAsSystem` izin listesinde). Kabul oturum açmaz ve mağaza değiştirmez. Ayrıntı: SECURITY.md §7.
- Tüm endpoint'ler varsayılan olarak kimlik doğrulama ister; açık olanlar `@Public()` ile işaretlenir.
- **RBAC:** roller ve izinler tenant bazındadır. İzinler `kaynak:eylem` biçiminde metindir (örn. `products:read`); `*` tüm izinleri verir. Kullanıcının izinleri access token'a yazılır, `@RequirePermissions()` ve `PermissionsGuard` ile kontrol edilir. `JwtAuthGuard` her istekte üyeliğin durumunu ve `auth_version`'ını okur (`401 SESSION_REVOKED` / `TOKEN_STALE`, bkz. SECURITY.md §3); token'daki izinler bu sayede bayat kalamaz.

## Frontend ve BFF

- `frontend/`: Next.js (App Router) + React + TypeScript, Tailwind CSS, shadcn/ui, TanStack Query (sunucu verisi), Zustand (yalnızca arayüz durumu), React Hook Form + Zod.
- **Tarayıcı backend'e doğrudan erişmez.** Next.js sunucusu BFF (Backend for Frontend) olarak çalışır: oturumu tutar, isteği doğrular ve izin verilen backend endpoint'ine iletir. Backend JWT, RBAC ve tenant kontrollerini her istekte yine kendisi yapar.
- Token'lar yalnızca BFF'in Redis oturum deposunda (şifreli) durur; tarayıcıda yalnızca rastgele oturum kimliği cookie'si vardır. Ayrıntılar: [SECURITY.md §5](SECURITY.md#5-frontend-bff-oturum-güvenliği).
- `frontend/server.mjs` giriş noktasıdır (geliştirme ve production): gerçek istemci IP'sini ve protokolü güvenilir proxy listesine göre belirler, production'da HTTPS zorunlu kılar.
- Kurumsal renkler: lacivert `#142C50` (ana renk), turuncu `#F47B20` (vurgu), beyaz. Turuncu üzerindeki metin laciverttir: beyaz metin turuncu zeminde WCAG AA kontrastını sağlamaz.

## Modüller

| Modül | Sorumluluk |
|---|---|
| `tenants` | Kiracı (müşteri hesabı), abonelik, tenant ayarları |
| `companies` | Tenant altındaki işletmeler: unvan, vergi, adres, e-Fatura bilgileri |
| `audit` | Değiştirilemez işlem geçmişi |
| `auth` | Kullanıcı, rol, yetki, oturum |
| `invitations` | E-posta davetleri: oluşturma, yeniden gönderme, iptal, lookup, kabul. Rol/firma atamalarını `AccessService`, üyeliği `MembershipsRepository`, global hesabı `AccountsService` (auth), firmaları `CompaniesService` üzerinden yazar/okur |
| `mail` | E-posta gönderimi: `MailService.send({ to, subject, html, text })`, SMTP veya log taşıyıcısı. Diğer modüller içeriği kendisi üretir, taşıyıcıya dokunmaz |
| `users` | Üye listesi, erişim düzenleme, pasife alma/aktifleştirme (USR-T11a). Tablo sahibi değildir: üyelikleri `MembershipsRepository`, rolleri `AccessService`, refresh token'ları `AccountsService` (auth), firmaları `CompaniesService` üzerinden okur/yazar |
| `catalog` | Ürün, kategori, marka, varyant (CAT-02: `/categories`, `/brands`, `/products` REST API; firmalar `CompaniesService`, izinler `AccessService.companyScope` / `assertCompanyPermission` üzerinden) |
| `inventory` | Stok, depo, stok hareketleri |
| `orders` | Sipariş, sipariş kalemi, durum akışı |
| `channels` | Pazaryeri ve satış kanalı entegrasyonları |
| `customers` | Müşteri ve adres bilgileri |
| `reports` | Satış ve stok raporları |
| `ai-engine` | AI öneri motoru, ürün analizleri, satış analizleri, otomasyon önerileri |

## AI Katmanı

| Bileşen | Görev |
|---|---|
| Öneri motoru | Fiyat, stok ve ürün önerileri |
| Ürün analizleri | Performans, eksik içerik, kategori uyumu |
| Satış analizleri | Trend, tahmin, kanal karşılaştırma |
| Otomasyon önerileri | Tekrarlayan işlemler için kural önerileri |

AI çıktıları öneri olarak sunulur; kullanıcı onayı olmadan veri değiştirmez.

## Backend Katmanları

Her modül içinde:

- `routes / controllers` — HTTP giriş noktası, doğrulama
- `services` — iş mantığı
- `repositories` — veri erişimi
- `models / entities` — veri yapıları
- `tests`

Modüller birbirinin veritabanı tablolarına doğrudan erişmez; servis arayüzleri üzerinden konuşur.

## Entegrasyonlar

- Her pazaryeri bir **adapter** olarak yazılır ve ortak `ChannelAdapter` arayüzünü uygular.
- Senkronizasyon (stok, fiyat, sipariş çekme) arka plan işi olarak kuyrukta çalışır (bkz. [Kuyruk](#kuyruk-arka-plan-işleri)).
- Dış API hataları yeniden denenir; başarısız işler loglanır.

## Ortamlar

- `local` — Docker Compose
- `staging`
- `production`

Yapılandırma ortam değişkenleri ile yönetilir.
