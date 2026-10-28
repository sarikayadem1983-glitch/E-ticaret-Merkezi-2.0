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

## Tenant İzolasyonu (zorunlu)

Tenant filtresi geliştiriciye bırakılmaz; Prisma seviyesinde zorunludur ve **fail-closed** çalışır.

- Her HTTP isteği boş bir tenant bağlamıyla (`AsyncLocalStorage`) başlar. JWT guard token'ı doğrulayınca bağlama `tenantId` yazar.
- Uygulamanın kullandığı tek Prisma istemcisi tenant eklentisiyle sarılıdır. Bağlamda tenant yoksa **hiçbir sorgu çalışmaz**, `TENANT_CONTEXT_MISSING` hatası döner (500 — geliştirici hatası).
- Eklenti her model işlemine `tenant_id = <bağlamdaki tenant>` koşulunu ekler, `create` verisine `tenantId` yazar. Sorguda veya yazılan veride (iç içe yazmalar dahil) farklı bir `tenantId` varsa işlem reddedilir. `Tenant` modeli `id` ile kısıtlanır.
- Ham SQL (`$queryRaw`, `$executeRaw`) tenant bağlamında yasaktır.
- Veritabanı seviyesinde ikinci güvence: tenant'a ait tablolar arası yabancı anahtarlar `(tenant_id, x_id)` → `(tenant_id, id)` biçiminde composite'tir; farklı tenant'ın kaydına ilişki kurulamaz.
- Tenant'tan önce çalışması gereken işlemler (giriş, kayıt, refresh token çözümü, health check) yalnızca `TenantContext.runAsSystem()` içinde çalışır. Bu fonksiyonu kullanabilecek dosyalar bir testte izin listesiyle sabitlenmiştir; yeni kullanım test kırar ve code review gerektirir.
- HTTP dışı işler (kuyruk worker'ları) `TenantContext.run(tenantId, fn)` ile çalışır.

## Kimlik Doğrulama ve Yetkilendirme

- Kısa ömürlü **access token** (JWT) + uzun ömürlü **refresh token**.
- Refresh token veritabanında hash'lenmiş saklanır, her kullanımda döndürülür (rotation), iptal edilebilir.
- Refresh token opak rastgele değerdir (JWT değildir); veritabanında SHA-256 hash'i tutulur. İptal edilmiş bir token tekrar kullanılırsa kullanıcının tüm refresh token'ları iptal edilir.
- Şifreler Argon2id ile hash'lenir.
- Tüm endpoint'ler varsayılan olarak kimlik doğrulama ister; açık olanlar `@Public()` ile işaretlenir.
- **RBAC:** roller ve izinler tenant bazındadır. İzinler `kaynak:eylem` biçiminde metindir (örn. `products:read`); `*` tüm izinleri verir. Kullanıcının izinleri access token'a yazılır, `@RequirePermissions()` ve `PermissionsGuard` ile kontrol edilir.

## Modüller

| Modül | Sorumluluk |
|---|---|
| `tenants` | Kiracı (mağaza/şirket), abonelik, tenant ayarları |
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
