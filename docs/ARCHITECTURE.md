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

## Kimlik Doğrulama ve Yetkilendirme

- Kısa ömürlü **access token** (JWT) + uzun ömürlü **refresh token**.
- Refresh token veritabanında hash'lenmiş saklanır, her kullanımda döndürülür (rotation), iptal edilebilir.
- **RBAC:** roller ve izinler tenant bazındadır. NestJS guard'ları ile endpoint düzeyinde kontrol edilir.

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
