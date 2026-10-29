# Görev Kaydı (Task Register)

Tüm görevlerin tek kaynağı. Durum güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".
Son güncelleme: 2026-10-29 (`feature/user-management` @ `946dec0`).

## Sözlük

**Durum**

| Kod | Anlamı |
|---|---|
| `DONE-MERGED` | Tamamlandı, PR merge edildi (dev ortamında çalışıyor) |
| `DONE-PR` | Tamamlandı ve incelendi, açık PR'da; **merge edilmedi, deploy edilmedi** |
| `DONE-NOT-DEPLOYED` | Merge edildi ama dev/staging/prod'a deploy edilmedi |
| `IN-PROGRESS` | Üzerinde çalışılıyor |
| `PLANNED` | Planlandı, başlanmadı |
| `BLOCKED` | Dış bir koşul bekliyor (onay, erişim, başka görev); neden "Not" sütununda |

**Öncelik:** P0 (sürümü bloklar) · P1 (sürüm için gerekli) · P2 (sürümde olmalı, kaydırılabilir) · P3 (sonraki sürüm)

**Mod:** `FAST` (düşük risk, tek uygulayıcı, ek inceleme yok) · `STANDARD` (uygulayıcı + standart PR kontrolü) · `CRITICAL` (güvenlik / tenant izolasyonu / ödeme / veri migration'ı; bağımsız inceleyici zorunlu). Ayrıntı: `AGENTS.md`.

**Sürüm:** A = MVP · B = Ticari SaaS · C = Gelişmiş SaaS (bkz. `RELEASE_PLAN.md`)

**Tahmin:** iş günü; spec/plan yazımı, uygulama, test, inceleme ve düzeltme döngüsü dahil, dış bekleme (onay, sandbox erişimi) hariç. Varsayımlar: `MASTER_ROADMAP.md` §6.

**Ortak kabul kuralı (her görev):** ilgili testler yeşil; tenant'a ait her sorgu `tenant_id` filtreli; yeni endpoint `API_DOCUMENTATION.md`'de; yeni tablo migration ile ve geri alınabilir; para `decimal` + para birimi; loglarda kişisel veri/gizli bilgi yok. Tabloda yalnızca göreve özgü kriterler yazılır.

**Test kısaltmaları:** U = backend unit, E = backend e2e (izole `tm_` DB), F = frontend unit, P = Playwright, M = migration provası (`backup-and-rehearse.sh`), S = güvenlik/izolasyon testi, L = yük testi.

---

## M01 — SaaS altyapısı ve güvenlik (`INF`)

### INF-E1 Temel altyapı

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INF-01 | Docker dev ortamı (PostgreSQL 16, Redis 7) | P0 | — | — | FAST | A | DONE-MERGED (PR #1) | `docker compose up` ile çalışır | — | Düşük |
| INF-02 | NestJS + Prisma iskeleti, Prisma tenant izolasyon eklentisi, auth modülü | P0 | INF-01 | — | CRITICAL | A | DONE-MERGED (PR #1) | Tenant context dışı sorgu `TenantViolationError` | U, E | Yüksek (izolasyon) |
| INF-03 | Append-only, tenant-scoped audit log | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #2) | UPDATE/DELETE DB seviyesinde reddedilir | U, E | Orta |
| INF-04 | En az yetkili PostgreSQL rolü (`tm_app`) | P0 | INF-03 | — | CRITICAL | A | DONE-MERGED (PR #2) | Uygulama sahip rolüyle çalışmaz | E | Yüksek |
| INF-05 | HTTP katmanı sertleştirme (helmet, CORS, body limit) | P0 | INF-02 | — | STANDARD | A | DONE-MERGED (PR #3) | `SECURITY.md` §2 | E | Orta |
| INF-06 | Redis tabanlı auth rate limiting (fail-closed) | P0 | INF-02 | — | STANDARD | A | DONE-MERGED (PR #3) | `SECURITY.md` §3 | U, E | Orta |
| INF-07 | Next.js BFF: Redis oturumu, CSRF, açık proxy koruması, güvenlik başlıkları | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #4) | `SECURITY.md` §5 | F, P | Yüksek |
| INF-08 | Yetkisiz erişim / oturum süresi e2e testleri, PR otomasyon kuralları | P1 | INF-07 | — | FAST | A | DONE-MERGED (PR #5) | — | P | Düşük |

### INF-E2 Arka plan işleri, CI ve ortamlar

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INF-09 | Kuyruk altyapısı (BullMQ/Redis): tenant context taşıyan job, retry/backoff, ölü kuyruk, idempotency anahtarı | P0 | PR #6 merge | 3 | CRITICAL | A | PLANNED | Job tenant context'i olmadan çalışamaz; başarısız iş ölü kuyrukta görünür | U, E, S | Yüksek (job'da tenant sızıntısı) |
| INF-10 | CI pipeline (GitHub Actions): lint, typecheck, unit, e2e (servis konteynerli PG/Redis), frontend test; PR'da zorunlu kontrol | P0 | — | 2 | STANDARD | A | PLANNED | PR'da tüm kontroller otomatik koşar; kırmızı PR merge edilemez | CI | Orta (CI'da secret) |
| INF-11 | Staging ortamı ve deploy pipeline (migration `migrate deploy` adımı, onay kapısı, geri dönüş) | P1 | INF-10 | 4 | CRITICAL | B | PLANNED | Tek komut/iş akışıyla staging deploy; rollback denenmiş | Smoke | Yüksek |
| INF-12 | Nesne depolama (S3 uyumlu; dev'de MinIO): tenant önekli anahtar, imzalı URL | P0 | — | 2 | STANDARD | A | PLANNED | Bir tenant başka tenant'ın nesnesine imzalı URL üretemez | U, E, S | Orta |
| INF-13 | Secret yönetimi ve yapılandırma doğrulaması (prod'da secret manager) | P1 | INF-11 | 2 | CRITICAL | B | PLANNED | Eksik/zayıf secret ile uygulama açılmaz | U | Yüksek |

### INF-E3 Canlı öncesi güvenlik sertleştirmesi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INF-14 | Redis yüksek erişilebilirlik (replika + failover) ve alarm | P0 | INF-11 | 3 | STANDARD | B | PLANNED | Birincil Redis düşünce login/oturum < 1 dk içinde döner | Kaos testi | Yüksek (fail-closed kesinti) |
| INF-15 | CAPTCHA (kayıt + tekrarlı başarısız login) ve sızmış şifre kontrolü (HIBP k-anonymity) | P1 | — | 2 | STANDARD | B | PLANNED | `SECURITY.md` §4 maddeleri kapanır | U, E | Orta |
| INF-16 | Nonce tabanlı CSP (`unsafe-inline` kaldırılır) | P1 | — | 2 | STANDARD | B | PLANNED | `script-src` nonce'lu; sayfalar çalışır | F, P | Orta (XSS) |
| INF-17 | Prod ağ/TLS yapılandırması: `TRUST_PROXY`, `BFF_TRUST_PROXY`, backend yalnız iç ağ, HTTPS | P0 | INF-11 | 2 | CRITICAL | B | PLANNED | `req.ip` gerçek istemci IP'si; backend internetten erişilemez | Smoke, S | Yüksek |
| INF-18 | Mağaza değiştirmede Redis hatası: sahte "token hırsızlığı" audit'i ve tüm cihazlardan çıkışın önlenmesi | P0 | PR #6 merge | 2 | CRITICAL | A | PLANNED | Switch sırasında Redis hatası → istek 503, refresh zinciri bozulmaz, `REFRESH_REUSE` audit'i yazılmaz | U, E (Redis hata enjeksiyonu) | Yüksek |
| INF-19 | BFF `forceRefresh` yarışı (`stillNeeded`) nedeniyle oturum kapanması | P1 | PR #6 merge | 2 | CRITICAL | A | PLANNED | Eşzamanlı iki istek tek refresh yapar, oturum açık kalır | F, P | Orta |
| INF-20 | Kayıtta `409` ile hesap varlığının sızması (kullanıcı numaralandırma) | P1 | USR-T9 | 1 | CRITICAL | B | PLANNED | Var olan e-postayla kayıt aynı yanıtı döner, sahibine e-posta gider | E, S | Orta |

## M02 — Kullanıcılar, firmalar, roller (`USR`)

### USR-E1 Firma yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| USR-01 | Tenant-scoped firma (company) API | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #3) | — | E | Yüksek |
| USR-02 | Firma ekranları (liste, detay, oluştur, düzenle) | P0 | USR-01, INF-07 | — | STANDARD | A | DONE-MERGED (PR #4) | — | F, P | Düşük |

### USR-E2 Kullanıcı yönetimi ve çoklu tenant üyeliği

Kaynak: `docs/superpowers/plans/2026-10-28-user-management.md` (T1–T16 numaraları korunur; tanımlar ve kabul testleri plandaki gibidir). Spec: `docs/superpowers/specs/2026-10-28-user-management-design.md`.

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| USR-T1 | Aşama 1 migration SQL'i, ön kontroller, doğrulama sorguları (`20261029090000_tenant_memberships`) | P0 | USR-01 | — | CRITICAL | A | DONE-PR (PR #6) | `verify-after.sql` tüm satırlar ok; rollback provası | M, E | Kritik (veri) |
| USR-T2 | Yedek ve izole prova betiği (`backup-and-rehearse.sh`), Aşama 2 SQL hazırlığı (`migrations-pending/`) | P0 | USR-T1 | — | CRITICAL | A | DONE-PR (PR #6) | Betik çıkış 0, restore kontrolü ok | M | Yüksek |
| USR-T3 | ⛔ Onay kapısı — dev DB'de Aşama 1 | P0 | USR-T2 | — | CRITICAL | A | DONE-PR (PR #6) | Görev yalnızca rapor üretti; dev DB migration'ı sonradan **kullanıcı onayıyla** uygulandı | M | Kritik |
| USR-T4 | Global kullanıcı modeli + üyelikle login/register | P0 | USR-T3 | — | CRITICAL | A | DONE-PR (PR #6) | Plan T4 testleri | U, E | Yüksek |
| USR-T5 | Mağaza değiştirme ve üyelik listesi (backend + BFF + seçici) | P0 | USR-T4 | — | CRITICAL | A | DONE-PR (PR #6) | Plan T5 testleri | U, E, F | Yüksek |
| USR-T6 | `auth_version` ile anında oturum geçersizleştirme | P0 | USR-T5 | — | CRITICAL | A | DONE-PR (PR #6) | Plan T6 testleri | U, E | Yüksek |
| USR-17 | Güvenlik düzeltmesi: pasif / soft-delete kullanıcıya login ve refresh'te token verilmemesi, yanlış şifre audit'i arka planda | P0 | USR-T6 | — | CRITICAL | A | DONE-PR (PR #6, `140d348`, `946dec0`) | Pasif/silinmiş kullanıcı login/refresh → 401, oturumları iptal | U, E | Yüksek |
| USR-T7 | Rol kataloğu, erişim servisi ve kurallar (`ROLE_CATALOG`, `AccessService`, `canGrant`, son owner koruması) | P0 | PR #6 merge, kullanıcı onayı | 2 | CRITICAL | A | BLOCKED (kullanıcı: "Task 7'ye başlama") | Plan T7 testleri | U | Yüksek (yetki yükseltme) |
| USR-T8 | Companies modülünü firma başına role bağla; `auth/me` yetenek bayrakları | P0 | USR-T7 | 2 | CRITICAL | A | PLANNED | Plan T8 testleri (A rolü B'ye erişemez, okuma/yazma ayrımı, eski token `TOKEN_STALE`) | E, S | Yüksek |
| USR-T9 | Mail modülü ve Mailpit | P0 | PR #6 merge | 2 | STANDARD | A | PLANNED | Plan T9 testleri | U | Orta |
| USR-T10 | Davet servisi (oluştur, yeniden gönder, iptal, lookup, kabul) | P0 | USR-T7, USR-T9 | 4 | CRITICAL | A | PLANNED | Plan T10 testleri | E, S | Yüksek |
| USR-T11 | Users modülü (liste, erişim düzenleme, pasife alma) | P0 | USR-T8, USR-T10 | 3 | CRITICAL | A | PLANNED | Plan T11 testleri | E, S | Yüksek |
| USR-T12 | BFF route'ları (kullanıcı/davet allowlist, oturumsuz davet route'ları) | P0 | USR-T11 | 1 | CRITICAL | A | PLANNED | Plan T12 testleri | F | Orta |
| USR-T13 | Kullanıcılar sayfası, davet diyaloğu, davet kabul sayfası | P0 | USR-T12 | 3 | STANDARD | A | PLANNED | lint + typecheck; davranış T15'te | F, P | Düşük |
| USR-T14 | Yetki yükseltme ve tenant izolasyonu test paketi | P0 | USR-T11 | 2 | CRITICAL | A | PLANNED | Plan T14 maddeleri PASS | S, E | Yüksek |
| USR-T15 | Playwright akışları (davet, erişim, mağaza değiştirme, mobil) | P1 | USR-T13 | 2 | STANDARD | A | PLANNED | 2 ardışık koşuda PASS | P | Düşük |
| USR-T16 | Tam doğrulama ve PR | P0 | USR-T14, USR-T15 | 1 | STANDARD | A | PLANNED | Plan T16 adımları | Tümü | Düşük |
| USR-18 | Aşama 2 migration: `users.tenant_id` / `users.is_active` eski kolonlarını kaldırma; önce guard ve login/refresh'in `users.is_active` okuması yeni modele taşınır | P1 | USR-T16, kullanıcı onayı | 3 | CRITICAL | B | BLOCKED (T16 + ayrı migration onayı) | `user-state.ts`, guard ve auth repository kolonu okumaz; prova + verify ok; rollback provası | M, U, E | Kritik (veri, erişim) |

### USR-E3 Hesap güvenliği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| USR-19 | Şifre sıfırlama ve e-posta doğrulama (hash'li tek kullanımlık token) | P0 | USR-T9 | 3 | CRITICAL | A | PLANNED | Token tek kullanımlık, süreli; sıfırlama tüm oturumları düşürür; yanıt hesap varlığını sızdırmaz | E, S | Yüksek |
| USR-20 | İki adımlı doğrulama (TOTP) ve kurtarma kodları | P2 | USR-19 | 3 | CRITICAL | B | PLANNED | Owner/admin için zorunlu kılınabilir | U, E | Orta |

## M03 — Dashboard (`DSH`)

### DSH-E1 Dashboard

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| DSH-01 | Uygulama kabuğu ve dashboard iskeleti | P1 | INF-07 | — | FAST | A | DONE-MERGED (PR #4) | — | P | Düşük |
| DSH-02 | KPI kartları: günlük sipariş, ciro, bekleyen kargo, düşük stok, entegrasyon hataları | P1 | ORD-02, INV-01, INT-03 | 3 | STANDARD | A | PLANNED | Değerler rapor sorgularıyla aynı; firma rolüne göre filtreli | E, P | Düşük |
| DSH-03 | Bildirim merkezi (uygulama içi + e-posta tercihleri) | P2 | INF-09, USR-T9 | 3 | STANDARD | B | PLANNED | Bildirim yalnızca yetkili kullanıcıya | E | Düşük |

## M04 — Ürün kataloğu (`CAT`)

### CAT-E1 Katalog çekirdeği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| CAT-01 | Katalog şeması: kategori, marka, ürün, varyant, barkod/SKU (tenant + firma kapsamlı) | P0 | USR-T8 | 3 | CRITICAL | A | PLANNED | Composite tenant FK'leri; SKU tenant içinde tekil; migration provası | M, E | Yüksek (izolasyon) |
| CAT-02 | Ürün CRUD API (liste, filtre, sayfalama, soft-delete, audit) | P0 | CAT-01 | 3 | STANDARD | A | PLANNED | Firma rolü izinleri uygulanır | E, S | Orta |
| CAT-03 | Varyant ve özellik (attribute) yönetimi | P0 | CAT-02 | 4 | STANDARD | A | PLANNED | Renk/beden gibi eksenlerden varyant üretimi | U, E | Düşük |
| CAT-04 | Katalog UI: liste, filtre, ürün formu, varyant editörü | P0 | CAT-03 | 4 | STANDARD | A | PLANNED | Mobilde kullanılabilir | F, P | Düşük |
| CAT-05 | Fiyat yönetimi: liste fiyatı, kanal fiyatı, KDV oranı (`decimal` + para birimi) | P0 | CAT-02 | 2 | STANDARD | A | PLANNED | Float yok; yuvarlama kuralı belgelendi | U, E | Orta (finansal doğruluk) |

### CAT-E2 Pazaryeri kategori/özellik eşleme

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| CAT-06 | Kanal kategori ağacı ve zorunlu özellik eşleme modeli + UI | P0 | CAT-03, INT-01 | 4 | STANDARD | A | PLANNED | Eksik zorunlu özellik listeleme öncesi gösterilir | U, E | Düşük |

## M05 — AI destekli ürün yükleme (`AIU`)

`ai-engine` bağımsızdır: katalog verisini doğrudan okumaz; çağıran modül veriyi istek içinde verir, öneri döner, kullanıcı onaylar.

### AIU-E1 AI ile ürün içeriği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| AIU-01 | Başlık/açıklama/anahtar kelime önerisi (pazaryeri kurallarına göre), onaylı uygulama | P2 | AIE-01, CAT-04 | 3 | STANDARD | C | PLANNED | Öneri onaysız kaydedilmez; maliyet tenant kotasına yazılır | U, E | Orta (prompt injection) |
| AIU-02 | Görselden özellik çıkarma (renk, materyal, kategori önerisi) | P3 | AIE-01, IMG-01 | 3 | STANDARD | C | PLANNED | Güven skoru düşükse öneri işaretlenir | U | Orta |
| AIU-03 | Toplu AI zenginleştirme (içe aktarılan ürünler için kuyrukta) | P3 | AIU-01, IMP-02 | 2 | STANDARD | C | PLANNED | Kota aşımında iş durur, kısmi sonuç raporlanır | E | Orta |

## M06 — Toplu içe aktarma: Excel/CSV ve URL (`IMP`)

### IMP-E1 Toplu içe/dışa aktarma

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| IMP-01 | Excel/CSV şablonu, satır doğrulama, deneme (dry-run) raporu | P0 | CAT-03 | 3 | STANDARD | A | PLANNED | Hatalı satırlar satır/kolon bazında raporlanır; formül enjeksiyonu (CSV injection) engellenir | U, E | Orta |
| IMP-02 | Asenkron içe aktarma işi (kuyruk), ilerleme ve hata raporu indirme | P0 | IMP-01, INF-09 | 3 | STANDARD | A | PLANNED | 10.000 satır zaman aşımına düşmeden işlenir; yarıda kalan iş yeniden başlatılabilir | E, L | Orta |
| IMP-03 | URL'den ürün içe aktarma (sayfa/feed çekme) | P2 | IMP-02 | 4 | CRITICAL | B | PLANNED | SSRF koruması: özel IP/metadata adresleri reddedilir, boyut/süre sınırı, yönlendirme kontrolü | U, S | Yüksek (SSRF) |
| IMP-04 | Toplu dışa aktarma (ürün, stok, fiyat) | P2 | IMP-01 | 2 | FAST | B | PLANNED | Yalnızca kullanıcının yetkili firmaları | E | Düşük |

## M07 — Ürün görsel yönetimi (`IMG`)

### IMG-E1 Görseller

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| IMG-01 | Görsel yükleme, sıralama, ürün/varyanta bağlama | P0 | INF-12, CAT-02 | 3 | STANDARD | A | PLANNED | MIME içerikten doğrulanır, boyut sınırı, EXIF temizlenir | U, E, S | Orta (dosya yükleme) |
| IMG-02 | Yeniden boyutlandırma/türev üretimi ve pazaryeri görsel kurallarına uygunluk kontrolü | P1 | IMG-01, INF-09 | 2 | STANDARD | A | PLANNED | Kural ihlali listeleme öncesi gösterilir | U | Düşük |
| IMG-03 | AI arka plan temizleme / beyaz fon | P3 | IMG-02, AIE-01 | 2 | FAST | C | PLANNED | Orijinal korunur | U | Düşük |

## M08 — Pazaryeri API entegrasyonları (`INT`)

Her pazaryeri ayrı EPIC'tir ve ortak çerçeveyi (`INT-E0`) kullanır. Her pazaryeri için 3 görev: (1) bağlantı + ürün/listeleme, (2) stok ve fiyat senkronu, (3) sipariş, kargo, iptal/iade senkronu. Hakediş/finans API'leri `STL` modülündedir.

**Ortak kabul kriterleri (tüm pazaryeri görevleri):** sandbox/test hesabında uçtan uca senaryo; kimlik bilgileri şifreli saklanır ve loglanmaz; API rate limit'ine uyulur; geçici hatalar backoff ile yeniden denenir; her senkron idempotent; sözleşme testleri kayıtlı yanıtlarla (fixture) çalışır.

### INT-E0 Ortak entegrasyon çerçevesi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-01 | `ChannelAdapter` arayüzü, kanal hesabı modeli, kimlik bilgisi şifreleme (envelope encryption, anahtar rotasyonu) | P0 | USR-T8, INF-13 (dev'de yerel anahtar) | 4 | CRITICAL | A | PLANNED | Kimlik bilgisi DB'de düz metin değil; API yanıtlarında maskeli | U, E, S | Kritik (müşteri API anahtarları) |
| INT-02 | Senkron motoru: kanal başına rate limiter, retry, idempotency, senkron logu, çakışma çözümü | P0 | INT-01, INF-09 | 5 | CRITICAL | A | PLANNED | Aynı sipariş iki kez içeri alınmaz; başarısız iş görünür ve yeniden denenebilir | U, E | Yüksek |
| INT-03 | Entegrasyon yönetim UI: bağla, test et, durum, hata logu | P0 | INT-01 | 3 | STANDARD | A | PLANNED | Yalnızca yetkili roller kimlik bilgisi girer/görür (maskeli) | F, P | Orta |
| INT-04 | Webhook alıcısı (imza doğrulama, tekrar oynatma koruması) | P1 | INT-02 | 2 | CRITICAL | A | PLANNED | İmzasız/eski istek reddedilir | U, E, S | Yüksek |

### INT-E1 Trendyol

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-TY-01 | Trendyol bağlantısı + ürün oluşturma/güncelleme, batch durum takibi | P0 | INT-02, CAT-06, IMG-02 | 5 | STANDARD | A | PLANNED | Sandbox'ta ürün onaya gönderilir, batch sonucu ürüne işlenir | U, E | Orta |
| INT-TY-02 | Trendyol stok ve fiyat senkronu | P0 | INT-TY-01, INV-02 | 3 | STANDARD | A | PLANNED | Stok değişimi ≤ 5 dk içinde kanala yansır | U, E | Orta |
| INT-TY-03 | Trendyol sipariş çekme, paket durumu, kargo bilgisi, iptal/iade | P0 | INT-TY-01, ORD-02 | 5 | STANDARD | A | PLANNED | Sipariş idempotent içeri alınır; durum güncellemeleri kanala gönderilir | U, E | Orta |

### INT-E2 Hepsiburada

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-HB-01 | Hepsiburada bağlantısı + listeleme/katalog eşleme | P1 | INT-02, CAT-06 | 5 | STANDARD | A | PLANNED | Ortak kriterler | U, E | Orta |
| INT-HB-02 | Hepsiburada stok ve fiyat senkronu | P1 | INT-HB-01, INV-02 | 3 | STANDARD | A | PLANNED | Ortak kriterler | U, E | Orta |
| INT-HB-03 | Hepsiburada sipariş, paketleme, kargo, iptal/iade | P1 | INT-HB-01, ORD-02 | 5 | STANDARD | A | PLANNED | Ortak kriterler | U, E | Orta |

### INT-E3 Amazon Türkiye

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-AMZ-01 | Amazon SP-API bağlantısı (LWA OAuth, uygulama kaydı) + listeleme (Listings/Feeds) | P1 | INT-02, CAT-06 | 6 | CRITICAL | B | PLANNED | OAuth refresh token şifreli; ürün tipi şeması doğrulanır | U, E, S | Yüksek (OAuth) |
| INT-AMZ-02 | Amazon stok ve fiyat senkronu | P1 | INT-AMZ-01, INV-02 | 4 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta |
| INT-AMZ-03 | Amazon sipariş (PII için kısıtlı veri erişimi), kargo onayı, iade | P1 | INT-AMZ-01, ORD-02 | 5 | CRITICAL | B | PLANNED | PII yalnızca gereken süre saklanır (Amazon veri koruma politikası) | U, E, S | Yüksek (PII) |

### INT-E4 n11

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-N11-01 | n11 bağlantısı + ürün/listeleme | P1 | INT-02, CAT-06 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta |
| INT-N11-02 | n11 stok ve fiyat senkronu | P1 | INT-N11-01, INV-02 | 3 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta |
| INT-N11-03 | n11 sipariş, kargo, iptal/iade | P1 | INT-N11-01, ORD-02 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta |

### INT-E5 Pazarama

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-PZR-01 | Pazarama bağlantısı + ürün/listeleme | P2 | INT-02, CAT-06 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |
| INT-PZR-02 | Pazarama stok ve fiyat senkronu | P2 | INT-PZR-01, INV-02 | 3 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |
| INT-PZR-03 | Pazarama sipariş, kargo, iptal/iade | P2 | INT-PZR-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |

### INT-E6 ÇiçekSepeti

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-CS-01 | ÇiçekSepeti bağlantısı + ürün/listeleme | P2 | INT-02, CAT-06 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |
| INT-CS-02 | ÇiçekSepeti stok ve fiyat senkronu | P2 | INT-CS-01, INV-02 | 3 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |
| INT-CS-03 | ÇiçekSepeti sipariş, kargo, iptal/iade | P2 | INT-CS-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |

### INT-E7 Temu

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INT-TEMU-01 | Temu satıcı API bağlantısı + ürün/listeleme (TR satıcı API erişimi doğrulanmalı) | P3 | INT-02, CAT-06 | 6 | STANDARD | C | PLANNED | Ortak kriterler; API erişimi yoksa BLOCKED | U, E | Orta |
| INT-TEMU-02 | Temu stok ve fiyat senkronu | P3 | INT-TEMU-01, INV-02 | 4 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |
| INT-TEMU-03 | Temu sipariş, kargo, iptal/iade | P3 | INT-TEMU-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta |

## M09 — Siparişler (`ORD`)

### ORD-E1 Sipariş yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| ORD-01 | Sipariş şeması: sipariş, kalem, durum geçmişi, kanal referansı (tekil `channel + external_id`) | P0 | CAT-01 | 2 | CRITICAL | A | PLANNED | Tutarlar `decimal`; kanal sipariş no tenant içinde tekil; migration provası | M, E | Yüksek |
| ORD-02 | Sipariş API ve durum makinesi (geçersiz geçiş reddi, audit) | P0 | ORD-01 | 4 | STANDARD | A | PLANNED | Tüm geçişler test edilmiş tabloyla | U, E | Orta |
| ORD-03 | Sipariş UI: liste, filtre, detay, toplu işlem (etiket yazdır, durum) | P0 | ORD-02 | 3 | STANDARD | A | PLANNED | Mobilde kart görünümü | F, P | Düşük |
| ORD-04 | Manuel / telefonla sipariş girişi | P2 | ORD-02, CRM-01 | 2 | FAST | B | PLANNED | Stok düşümü otomatik | E | Düşük |

## M10 — Stok ve depo (`INV`)

### INV-E1 Stok yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| INV-01 | Depo ve stok şeması; append-only stok hareketleri | P0 | CAT-01 | 3 | CRITICAL | A | PLANNED | Stok = hareketlerin toplamı; hareket silinemez | M, E | Orta |
| INV-02 | Rezervasyon ve sipariş bağlı düşüm (eşzamanlılık güvenli) | P0 | INV-01, ORD-01 | 4 | CRITICAL | A | PLANNED | Paralel siparişlerde negatif stok oluşmaz (satır kilidi/koşullu güncelleme) | U, E, L | Orta (veri bütünlüğü) |
| INV-03 | Stok UI, düşük stok eşiği ve uyarısı | P1 | INV-01 | 2 | STANDARD | A | PLANNED | Eşik altı ürünler listelenir | F, P | Düşük |
| INV-04 | Çoklu depo transferi ve stok sayımı | P2 | INV-02 | 3 | STANDARD | B | PLANNED | Transfer iki hareket olarak kaydedilir | E | Düşük |

## M11 — Kargo, iptal ve iade (`SHP`)

### SHP-E1 Kargo ve iade süreçleri

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| SHP-01 | İptal ve iade akışı: talep, onay/ret, stok iadesi, kanal bildirimi | P0 | ORD-02, INV-02 | 4 | STANDARD | A | PLANNED | İade stok hareketi üretir; kanal durumu senkron | U, E | Orta |
| SHP-02 | Pazaryeri kargo entegrasyonu üzerinden etiket ve takip numarası | P0 | ORD-03, INT-TY-03 | 3 | STANDARD | A | PLANNED | Etiket PDF indirilir, takip no siparişe işlenir | E, P | Düşük |
| SHP-03 | Anlaşmalı kargo firmaları API'leri (ör. Yurtiçi, Aras, MNG) | P2 | SHP-02, INT-01 | 5 | STANDARD | B | PLANNED | En az 2 firma; kimlik bilgileri INT-01 ile saklanır | U, E | Orta |

## M12 — e-Fatura / e-Arşiv ve muhasebe (`EFT`)

### EFT-E1 e-Belge

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| EFT-01 | Özel entegratör adapter soyutlaması + ilk entegratör (sözleşme ve test hesabı gerekir) | P0 | INT-01, ORD-02 | 4 | CRITICAL | B | PLANNED | Entegratör kimlik bilgileri şifreli; test ortamında bağlantı | U, E, S | Yüksek (yasal belge) |
| EFT-02 | Siparişten e-Arşiv / e-Fatura kesimi (mükellef sorgusu, seri/numara, KDV) | P0 | EFT-01 | 5 | CRITICAL | B | PLANNED | Aynı sipariş için çift fatura kesilemez; tutarlar siparişle birebir | U, E | Yüksek |
| EFT-03 | Fatura iptali ve iade faturası | P1 | EFT-02, SHP-01 | 3 | CRITICAL | B | PLANNED | Yasal süre kuralları uygulanır | U, E | Yüksek |
| EFT-04 | Faturanın pazaryerine iletilmesi (link/PDF) | P1 | EFT-02, INT-TY-03 | 2 | STANDARD | B | PLANNED | Trendyol ve HB'de fatura siparişe bağlanır | E | Düşük |
| EFT-05 | Muhasebe dışa aktarımı (ör. Logo, Mikro, Paraşüt formatları) | P3 | EFT-02 | 4 | STANDARD | C | PLANNED | En az 1 format | U | Düşük |

## M13 — Müşteriler ve tedarikçiler (`CRM`)

### CRM-E1 Müşteri ve tedarikçi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| CRM-01 | Müşteri modeli (siparişten türetme, adres), KVKK alan maskeleme | P1 | ORD-01 | 2 | CRITICAL | A | PLANNED | Kişisel veri yetkisiz rollere maskeli; loglara yazılmaz | E, S | Yüksek (KVKK) |
| CRM-02 | Müşteri UI: liste, detay, sipariş geçmişi | P2 | CRM-01 | 2 | FAST | A | PLANNED | — | F | Düşük |
| CRM-03 | Tedarikçi ve satın alma siparişi (stok girişine bağlı) | P2 | INV-01 | 4 | STANDARD | B | PLANNED | Mal kabul stok hareketi üretir | E | Düşük |

## M14 — Kampanya ve reklam (`CMP`)

### CMP-E1 Kampanya ve reklam

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| CMP-01 | Kanal kampanya/indirim yönetimi (planlı fiyat değişimi, geri alma) | P2 | CAT-05, INT-TY-02 | 4 | STANDARD | B | PLANNED | Kampanya bitince fiyat otomatik geri döner | U, E | Orta (yanlış fiyat) |
| CMP-02 | Reklam harcaması içe aktarma (kanal reklam API'leri / dosya) | P3 | INT-02 | 3 | STANDARD | C | PLANNED | Harcama ürün/kampanyaya bağlanır | U | Düşük |
| CMP-03 | AI kampanya optimizasyon önerisi (bütçe, indirim oranı) | P3 | CMP-02, PRF-02, AIE-01 | 4 | STANDARD | C | PLANNED | Yalnızca öneri; onaysız uygulanmaz | U | Orta |

## M15 — Kârlılık ve gider hesaplama (`PRF`)

### PRF-E1 Kârlılık

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| PRF-01 | Maliyet ve gider modeli: ürün maliyeti, komisyon tablosu, kargo, sabit gider dağıtımı | P1 | CAT-05, ORD-01 | 3 | STANDARD | B | PLANNED | Tüm tutarlar `decimal`; tarih aralıklı komisyon | U, E | Orta |
| PRF-02 | Sipariş ve ürün bazlı kâr hesaplama (iade/iptal etkisi dahil) | P1 | PRF-01, SHP-01 | 4 | STANDARD | B | PLANNED | Örnek veri setinde elle hesapla birebir | U | Orta (finansal doğruluk) |
| PRF-03 | Kârlılık raporu UI (ürün, kanal, dönem) | P1 | PRF-02 | 3 | STANDARD | B | PLANNED | — | F, P | Düşük |

## M16 — Hakediş ve mutabakat (`STL`)

### STL-E1 Hakediş

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| STL-01 | Hakediş/finans verisi çekme (Trendyol, Hepsiburada finans API'leri) | P1 | INT-TY-03, INT-HB-03 | 5 | STANDARD | B | PLANNED | Ödeme kalemleri siparişlere bağlanır | U, E | Orta |
| STL-02 | Mutabakat motoru: beklenen (sipariş − komisyon − kesinti) vs ödenen | P1 | STL-01, PRF-01 | 4 | STANDARD | B | PLANNED | Fark kuruş düzeyinde doğru | U | Orta |
| STL-03 | Fark raporu ve UI | P1 | STL-02 | 3 | STANDARD | B | PLANNED | — | F, P | Düşük |

## M17 — Raporlama (`RPT`)

### RPT-E1 Raporlar

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| RPT-01 | Satış raporları (dönem, kanal, ürün) | P1 | ORD-02 | 3 | STANDARD | A | PLANNED | Firma rolüne göre filtreli | E | Düşük |
| RPT-02 | Stok raporları (değer, devir, stoksuz kalma) | P1 | INV-02 | 2 | STANDARD | A | PLANNED | — | E | Düşük |
| RPT-03 | Excel/PDF dışa aktarma ve zamanlanmış e-posta raporu | P2 | RPT-01, INF-09, USR-T9 | 3 | STANDARD | B | PLANNED | Rapor yalnızca yetkili alıcıya | E | Düşük |
| RPT-04 | Gelişmiş analitik (kanal karşılaştırma, kohort, trend) | P3 | RPT-01, PRF-02 | 5 | STANDARD | C | PLANNED | Ağır sorgular okuma replikasında/ön-hesaplı | E, L | Düşük |

## M18 — AI asistan ve otomasyonlar (`AIE`)

`ai-engine` diğer modüllerden bağımsızdır (AGENTS.md): kendi tablolarını kullanır, diğer modüllerin tablolarını okumaz; veri, açık bir sözleşmeyle (istek gövdesi veya diğer modüllerin yayınladığı salt-okunur servis arayüzü) gelir; çıktısı öneridir, kullanıcı onayı olmadan veri değiştirmez.

### AIE-E1 AI motoru ve otomasyon

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| AIE-01 | `ai-engine` çekirdeği: LLM sağlayıcı soyutlaması, tenant kotası/maliyet takibi, prompt injection ve veri sızıntısı koruması | P1 | INF-09 | 5 | CRITICAL | C | PLANNED | Modül başka modül tablosuna erişmez (mimari testi); istek başka tenant verisi içeremez | U, S | Yüksek |
| AIE-02 | AI asistan (sohbet): salt-okunur, kullanıcının yetkisiyle sınırlı sorular | P2 | AIE-01, RPT-01 | 5 | CRITICAL | C | PLANNED | Asistan kullanıcının göremediği veriyi döndüremez | S, E | Yüksek |
| AIE-03 | Kural tabanlı otomasyonlar (fiyat/stok kuralları; öneri → onay → uygula) | P2 | AIE-01, INT-TY-02 | 5 | STANDARD | C | PLANNED | Onaysız değişiklik yok; her uygulama audit'li | U, E | Orta |
| AIE-04 | Satış tahmini ve stok yenileme önerisi | P3 | AIE-01, RPT-02 | 5 | STANDARD | C | PLANNED | Geri test (backtest) metrikleri raporlanır | U | Düşük |

## M19 — Abonelik ve ödeme (`SUB`)

### SUB-E1 Abonelik

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| SUB-01 | Plan/paket ve limit modeli (kanal sayısı, ürün, kullanıcı) | P0 | PR #6 merge | 2 | CRITICAL | B | PLANNED | Plan değişikliği audit'li | U, E | Orta |
| SUB-02 | Ödeme sağlayıcı entegrasyonu (ör. iyzico/PayTR; kart saklama sağlayıcıda, tokenization) | P0 | SUB-01 | 5 | CRITICAL | B | PLANNED | Kart verisi sistemimize girmez (PCI kapsamı dışı); webhook imzalı | U, E, S | Kritik (ödeme) |
| SUB-03 | Faturalama döngüsü: deneme süresi, yenileme, başarısız ödeme takibi (dunning), abonelik faturası | P0 | SUB-02, EFT-02 | 4 | CRITICAL | B | PLANNED | Çift tahsilat olmaz (idempotent) | U, E | Yüksek |
| SUB-04 | Limit uygulama (feature gating) ve plan aşımı uyarısı | P1 | SUB-01 | 3 | STANDARD | B | PLANNED | Limit hem API'de hem UI'da uygulanır | E | Orta |

## M20 — Sistem yönetimi, izleme ve güvenlik (`OPS`)

### OPS-E1 İzleme, yedekleme, performans

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| OPS-01 | Yapılandırılmış log + hata izleme (ör. Sentry), istek kimliği | P0 | — | 2 | STANDARD | A | PLANNED | Loglarda kişisel veri/secret yok (otomatik maskeleme testi) | U | Orta |
| OPS-02 | Metrikler, uptime ve alarm (DB, Redis, kuyruk, entegrasyon hata oranı) | P0 | OPS-01, INF-11 | 3 | STANDARD | B | PLANNED | Alarm kanalı test edildi | Smoke | Orta |
| OPS-03 | Otomatik yedekleme ve geri yükleme (PITR), geri yükleme tatbikatı | P0 | — | 3 | CRITICAL | A | PLANNED | Belgelenmiş RPO/RTO; tatbikat başarılı | M | Kritik |
| OPS-06 | Yük ve performans testi (senkron, sipariş içeri alma, raporlar) | P1 | INF-11 | 3 | STANDARD | B | PLANNED | Hedef p95 süreleri belgelendi ve karşılandı | L | Orta |

### OPS-E2 Yönetim ve uyum

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski |
|---|---|---|---|---|---|---|---|---|---|---|
| OPS-04 | Sistem yöneticisi (süper admin) paneli: tenant listesi, askıya alma, süreli ve audit'li destek erişimi | P1 | USR-T11, SUB-01 | 5 | CRITICAL | B | PLANNED | Destek erişimi tenant onaylı, süreli, audit'li; normal kullanıcı erişemez | E, S | Kritik |
| OPS-05 | KVKK: veri dışa aktarma/silme talebi, saklama süreleri, aydınlatma metni | P0 | CRM-01, USR-T11 | 4 | CRITICAL | B | PLANNED | Silme talebi audit bütünlüğünü bozmadan anonimleştirir | E | Yüksek |
| OPS-07 | Bağımsız güvenlik denetimi / sızma testi ve bulguların kapatılması | P0 | B sürümü özellik tamamlığı | 4 | CRITICAL | B | PLANNED | Kritik/yüksek bulgu kalmaz | S | Yüksek |

---

## Özet sayılar

| Ölçü | Değer |
|---|---|
| Modül | 20 |
| EPIC | 33 |
| Görev | 133 |
| DONE-MERGED | 11 |
| DONE-PR (PR #6, merge ve deploy yok) | 7 |
| DONE-NOT-DEPLOYED | 0 |
| IN-PROGRESS | 0 |
| BLOCKED | 2 (USR-T7, USR-18) |
| PLANNED | 113 |
| Sürüm A (MVP) | 69 (18 tamamlandı + 51 kalan) |
| Sürüm B (Ticari) | 43 |
| Sürüm C (Gelişmiş) | 21 |
| Mod: CRITICAL / STANDARD / FAST | 51 / 75 / 7 |
