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
- HTTP dışı işler (kuyruk worker'ları) `TenantContext.run(tenantId, fn)` ile çalışır.

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
- **Kullanıcı ve üyelik modeli:** `users` global kimliktir (tek e-posta, küçük harf, tüm tenant'larda tek hesap). Kişinin bir tenant'taki varlığı `tenant_memberships` satırıdır (`status` active/inactive, `auth_version`); roller (`user_roles`), firma rolleri (`user_company_roles`) ve refresh token'lar üyeliğe bağlıdır. `users.tenant_id` ve `users.is_active` faz 1'de artık okunmaz (faz 2'de kaldırılır). Üyelik tablosuna yalnızca `memberships` modülü (`MembershipsRepository`) erişir.
- **Login:** e-posta global kullanıcıda doğrulanır; aktif tenant'lardaki aktif üyelikler alınır. Üyelik yoksa genel `Email veya şifre hatalı`; birden fazlaysa `last_tenant_id` aktifse o, değilse tenant adına göre ilki seçilir. Access token: `sub`, `tid`, `perms` (o üyeliğin mağaza + firma rollerinin birleşimi), `ver` (üyeliğin `auth_version`'ı).
- **Kayıt:** tek transaction'da tenant, global kullanıcı (`last_tenant_id` = yeni tenant), aktif owner üyeliği, beş sistem rolü (tek `INSERT`, `createManyAndReturn`) ve owner ataması. Şifre hash'i ve refresh token üretimi transaction dışında yapılır; transaction 8 sorgudur (ölçülen en kötü 0,72 sn); `timeout: 10_000` yalnızca güvenlik sınırıdır.
- **Sistem rolleri:** `backend/src/access/roles.catalog.ts` izinlerin tek kaynağıdır. `key`'i olan rollerin izinleri katalogdan, `key`'i olmayan (eski/özel) rollerin izinleri `roles.permissions` kolonundan okunur.
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
| `catalog` | Ürün, kategori, marka, varyant |
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
- Senkronizasyon (stok, fiyat, sipariş çekme) arka plan işi olarak kuyrukta çalışır.
- Dış API hataları yeniden denenir; başarısız işler loglanır.

## Ortamlar

- `local` — Docker Compose
- `staging`
- `production`

Yapılandırma ortam değişkenleri ile yönetilir.
