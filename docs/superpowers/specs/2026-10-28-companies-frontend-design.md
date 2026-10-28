# Firma Yönetimi + Frontend Foundation — Tasarım

Tarih: 2026-10-28 · Branch: `feature/companies-frontend`

## Amaç

Tarayıcıdan açılan, gerçek backend'e bağlı ilk çalışan arayüz. Kullanıcı:

- kayıt olur veya giriş yapar,
- modern bir dashboard görür,
- firmalarını listeler, ekler, düzenler, pasife alır.

Kurumsal renkler lacivert, turuncu, beyaz. Mevcut backend mimarisi ve güvenlik katmanı korunur.

## Hedefler / Hedef dışı / Başarısızlık sayılır

**Hedefler**
- `companies` backend modülü: CRUD (silme yok, pasife alma var), tenant izolasyonu, Audit Log.
- Firma bazlı yetkilendirme **altyapısı**: `user_company_roles` tablosu ve erişim kontrolü.
- Next.js frontend: giriş, kayıt, dashboard, firma listesi, firma ekleme/düzenleme, sol menü, mobil uyum.

**Hedef dışı (sonraki aşamalar)**
- Kullanıcı davet etme, kullanıcı yönetimi, kullanıcıya firma atama ekranları.
- Pazaryeri, e-Fatura, stok, sipariş modülleri. Dashboard'da bunlar "yakında" boş durumlarıyla gösterilir; sahte veri yok.
- Şifre sıfırlama, e-posta doğrulama.

**Başarısızlık sayılır (çalışsa bile)**
- Token'ların JavaScript'in okuyabileceği bir yerde durması.
- Bir tenant'ın başka tenant'ın firmasını görmesi.
- Dashboard'da gerçek olmayan rakamlar.

## Yaklaşımlar (oturum yönetimi)

| | Yaklaşım | Değerlendirme |
|---|---|---|
| **A — seçildi** | Next.js BFF: tarayıcı yalnızca Next.js ile konuşur, token'lar `httpOnly` cookie'de | XSS'te token çalınamaz; backend değişmez; CORS gerekmez |
| B | Token'lar tarayıcıda (bellek + `localStorage`) | En basit; XSS refresh token'ı çaldırır. Reddedildi. |
| C | Backend refresh token'ı cookie olarak verir | A kadar güvenli; backend auth, CORS ve CSRF yeniden yazılır. Reddedildi. |

Kullanıcı A'yı seçti. Firma yetkilendirmesinde "yalnızca altyapı" seçildi.

## Backend: `companies` modülü

### Veri modeli (Prisma, `database/prisma/schema.prisma`)

`companies`
- `id` (uuid), `tenant_id`
- `legal_name` (ticari unvan, 2–250)
- `tax_number` — VKN (10 hane, resmi kontrol hanesi algoritması) veya TCKN (11 hane, kontrol haneleriyle). Tenant içinde tekil: `(tenant_id, tax_number)`.
- `tax_office` (vergi dairesi)
- adres: `address_line`, `district`, `city`, `postal_code` (opsiyonel), `country` (varsayılan `TR`)
- iletişim: `phone`, `email` (opsiyonel)
- `e_invoice_enabled` (bool), `e_invoice_alias` (opsiyonel posta kutusu etiketi)
- `is_active` (pasife alma), `created_at`, `updated_at`

`DATABASE.md`'deki taslaktaki `deleted_at` yerine `is_active` kullanılır: firma silinmez, pasife alınır (ileride fatura/sipariş kayıtları firmaya bağlı kalacak).

`user_company_roles`
- `tenant_id`, `user_id`, `company_id`, `role_id`. PK `(user_id, company_id, role_id)`.
- Composite FK'ler `(tenant_id, x_id)` → `(tenant_id, id)` (mevcut kural).

Migration `tm_migrator` ile; `tm_app` yetkileri default privileges ile gelir. Tenant Prisma eklentisi yeni modellere uygulanır.

### API (`/api/v1/companies`)

| Metot | Yol | İzin |
|---|---|---|
| GET | `/companies?search=&status=active\|inactive\|all&page=&pageSize=` | `companies:read` |
| GET | `/companies/:id` | `companies:read` |
| POST | `/companies` | `companies:write` |
| PATCH | `/companies/:id` | `companies:write` |
| POST | `/companies/:id/deactivate`, `/companies/:id/activate` | `companies:write` |

- **Erişim kuralı:** `*` veya tenant seviyesinde `companies:*` iznine sahip kullanıcı tenant'ın tüm firmalarını görür. Diğer kullanıcılar yalnızca `user_company_roles` ile atandıkları firmaları görür. Erişimi olmayan firmaya istek `404` döner (varlığı açığa çıkmaz). Bugün sadece owner olduğu için pratikte tüm firmalar görünür; kural testle doğrulanır.
- Aynı vergi numarası → `409 CONFLICT`.
- Audit Log: `CREATE`, `UPDATE` (yalnızca değişen alanlar), `DEACTIVATE`, `ACTIVATE`.
- Diğer modüller ileride `CompaniesService` üzerinden erişir, tabloya doğrudan değil.

## Frontend (`frontend/`)

### Teknoloji

Next.js 16 (App Router) + React + TypeScript, Tailwind CSS, shadcn/ui, TanStack Query (sunucu verisi), Zustand (yalnızca UI durumu, ör. mobil menü), React Hook Form + Zod (formlar). Sürümler sabitlenir (`-E`). Arayüz dili Türkçe.

### Oturum (BFF)

Kullanıcı A'yı şu ek şartlarla onayladı: tarayıcıda yalnızca rastgele oturum kimliği; JWT ve refresh token Next.js sunucu tarafında Redis'te; session fixation, süreler, rotation, eşzamanlı refresh ve güvenli çıkış ele alınmalı; production'da HTTPS zorunlu; BFF açık proxy olmamalı; gerçek IP yalnızca güvenilir proxy zincirinden.

Uygulanan tasarım `docs/SECURITY.md` §5'te. Özet:
- Cookie `__Host-tm_sid` (HttpOnly, Secure, SameSite=Lax), değer 256 bit rastgele.
- Redis'te `bff:sess:<sha256(sid)>`, AES-256-GCM ile şifreli; 2 saat kayan, 12 saat mutlak süre.
- Refresh için Redis kilidi (tek refresh, diğer istekler bekler).
- CSRF: Origin birebir + `Sec-Fetch-Site` + `X-TM-CSRF` başlığı.
- `/api/bff/*` izin listesi; hedef her zaman `BACKEND_URL`.
- `server.mjs`: IP ve protokol soket + `BFF_TRUST_PROXY`'den; production'da HTTP → 308/426, HSTS.

### Sayfalar

- `/login`, `/register` (yeni mağaza + sahibi), `/profile` (profil + çıkış)
- Üst çubukta firma seçici: seçim sunucu tarafı oturumda tutulur, backend erişimi doğruladıktan sonra.
- `/companies/[id]`: firma detayı; `/companies/[id]/edit`: düzenleme.
- `/dashboard`: hoş geldin başlığı; firma sayısı (aktif/pasif) kartları; son eklenen firmalar; Sipariş, Stok, Pazaryeri, e-Fatura için "yakında" kartları.
- `/companies`: arama, durum filtresi, sayfalama; masaüstünde tablo, mobilde kart listesi.
- `/companies/new`, `/companies/[id]`: aynı form; düzenlemede pasife al / aktifleştir.
- Ortak yerleşim: solda lacivert menü (Dashboard, Firmalar; ileride gelecek modüller pasif görünür), üstte kullanıcı menüsü ve çıkış. Mobilde menü çekmece olur.

### Tasarım

- Lacivert ana renk (menü, başlıklar), turuncu vurgu (birincil butonlar, aktif menü öğesi, odak halkası), beyaz/çok açık gri zemin.
- Renkler Tailwind/shadcn tema değişkeni olarak tanımlanır; kontrast WCAG AA.
- Formlarda alan bazlı Türkçe hata mesajları; VKN/TCKN istemcide de doğrulanır, son karar backend'de.

## Test ve doğrulama

- Backend: VKN/TCKN doğrulama unit testleri; companies e2e (CRUD, tenant izolasyonu, erişim kuralı, 409, audit kayıtları).
- Frontend: Vitest + Testing Library (form doğrulama, BFF cookie/refresh/CSRF mantığı); `tsc`, lint, `next build`.
- Uçtan uca: Playwright ile bir akış — kayıt → dashboard → firma ekle → düzenle → pasife al.
- Docs: `ARCHITECTURE.md`, `DATABASE.md`, `API_DOCUMENTATION.md`, `SECURITY.md` (BFF, CSRF, refresh kilidi).

## Teslim

Tek PR, `main` hedefli (backend ve frontend ayrı commit'lerde).

## Builder'a kalanlar

Bileşen yapısı, dosya düzeni, ikonlar (lucide), boş durum metinleri, sayfalama varsayılanı (20).
