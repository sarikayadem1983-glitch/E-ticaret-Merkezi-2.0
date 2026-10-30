# Görev Kaydı (Task Register)

Tüm görevlerin tek kaynağı. Durum güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".
Son güncelleme: 2026-10-30 (`main` @ `8fc7ae3` dev'e deploy edildi; USR-T11a dev'de; migration yok; smoke çıktısı kaydedilmedi, doğrulanamadı). Önceki: `9653158` — `f010233` dev'e deploy edildi, CAT-01 dev DB'ye uygulandı; OPS-08 ve USR-21 eklendi.

> **Onay durumu:** Yalnızca kullanıcı yönetimi planındaki görevler (`USR-T1`…`USR-T16`, plan: `docs/superpowers/plans/2026-10-28-user-management.md`) ve merge edilmiş işler (INF-01…08, USR-01, USR-02, DSH-01) **onaylı plandır**. Diğer tüm modüller, görevler, tahminler ve tarihler **öneridir, kullanıcı onayı beklemektedir**. Her görevin kaynağı `TASK_REGISTER.md`'deki "Kaynak" sütunundadır.


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

**Kaynak:** `Onaylı plan` (kullanıcı yönetimi planı T1–T16 ve merge edilmiş işler; T1–T16 tanımları plandaki gibidir) · `PR #6 güvenlik düzeltmesi (uygulandı)` (USR-17; plan dışı, PR #6'da) · `Öneri (onay bekliyor)` (bu yol haritasının önerisi, onaylanmadan başlanmaz)

**Öncelik:** P0 (sürümü bloklar) · P1 (sürüm için gerekli) · P2 (sürümde olmalı, kaydırılabilir) · P3 (sonraki sürüm)

**Mod:** `FAST` (düşük risk, tek uygulayıcı, ek inceleme yok) · `STANDARD` (uygulayıcı + standart PR kontrolü) · `CRITICAL` (güvenlik / tenant izolasyonu / ödeme / veri migration'ı; bağımsız inceleyici zorunlu). Ayrıntı: `AGENTS.md`.

**Sürüm:** A = MVP · B = Ticari SaaS · C = Gelişmiş SaaS (bkz. `RELEASE_PLAN.md`)

**Tahmin:** iş günü; spec/plan yazımı, uygulama, test, inceleme ve düzeltme döngüsü dahil, dış bekleme (onay, sandbox erişimi) hariç. Varsayımlar: `MASTER_ROADMAP.md` §6.

**Ortak kabul kuralı (her görev):** ilgili testler yeşil; tenant'a ait her sorgu `tenant_id` filtreli; yeni endpoint `API_DOCUMENTATION.md`'de; yeni tablo migration ile ve geri alınabilir; para `decimal` + para birimi; loglarda kişisel veri/gizli bilgi yok. Tabloda yalnızca göreve özgü kriterler yazılır.

**Test kısaltmaları:** U = backend unit, E = backend e2e (izole `tm_` DB), F = frontend unit, P = Playwright, M = migration provası (`backup-and-rehearse.sh`), S = güvenlik/izolasyon testi, L = yük testi.

---

## M01 — SaaS altyapısı ve güvenlik (`INF`)

### INF-E1 Temel altyapı

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INF-01 | Docker dev ortamı (PostgreSQL 16, Redis 7) | P0 | — | — | FAST | A | DONE-MERGED (PR #1) | `docker compose up` ile çalışır | — | Düşük | Onaylı plan |
| INF-02 | NestJS + Prisma iskeleti, Prisma tenant izolasyon eklentisi, auth modülü | P0 | INF-01 | — | CRITICAL | A | DONE-MERGED (PR #1) | Tenant context dışı sorgu `TenantViolationError` | U, E | Yüksek (izolasyon) | Onaylı plan |
| INF-03 | Append-only, tenant-scoped audit log | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #2) | UPDATE/DELETE DB seviyesinde reddedilir | U, E | Orta | Onaylı plan |
| INF-04 | En az yetkili PostgreSQL rolü (`tm_app`) | P0 | INF-03 | — | CRITICAL | A | DONE-MERGED (PR #2) | Uygulama sahip rolüyle çalışmaz | E | Yüksek | Onaylı plan |
| INF-05 | HTTP katmanı sertleştirme (helmet, CORS, body limit) | P0 | INF-02 | — | STANDARD | A | DONE-MERGED (PR #3) | `SECURITY.md` §2 | E | Orta | Onaylı plan |
| INF-06 | Redis tabanlı auth rate limiting (fail-closed) | P0 | INF-02 | — | STANDARD | A | DONE-MERGED (PR #3) | `SECURITY.md` §3 | U, E | Orta | Onaylı plan |
| INF-07 | Next.js BFF: Redis oturumu, CSRF, açık proxy koruması, güvenlik başlıkları | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #4) | `SECURITY.md` §5 | F, P | Yüksek | Onaylı plan |
| INF-08 | Yetkisiz erişim / oturum süresi e2e testleri, PR otomasyon kuralları | P1 | INF-07 | — | FAST | A | DONE-MERGED (PR #5) | — | P | Düşük | Onaylı plan |

### INF-E2 Arka plan işleri, CI ve ortamlar

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INF-09 | Kuyruk altyapısı (BullMQ/Redis): tenant context taşıyan job, retry/backoff, ölü kuyruk, idempotency anahtarı | P0 | PR #6 merge | 3 | CRITICAL | A | DONE-MERGED (PR #14, merge `6fef239`; dev `f010233`, 2026-10-30) | Job tenant context'i olmadan çalışamaz; başarısız iş ölü kuyrukta görünür | U, E, S | Yüksek (job'da tenant sızıntısı) | Öneri (onay bekliyor) |
| INF-10 | CI pipeline (GitHub Actions): lint, typecheck, unit, e2e (servis konteynerli PG/Redis), frontend test; PR'da zorunlu kontrol | P0 | — | 2 | STANDARD | A | DONE-MERGED (PR #11, merge `9c405bd`; dev `f010233`, 2026-10-30) | PR'da tüm kontroller otomatik koşar; kırmızı PR merge edilemez | CI | Orta (CI'da secret) | Öneri (onay bekliyor) |
| INF-11 | Staging ortamı ve deploy pipeline (migration `migrate deploy` adımı, onay kapısı, geri dönüş) | P1 | INF-10 | 4 | CRITICAL | B | PLANNED | Tek komut/iş akışıyla staging deploy; rollback denenmiş | Smoke | Yüksek | Öneri (onay bekliyor) |
| INF-12 | Nesne depolama (S3 uyumlu; dev'de MinIO): tenant önekli anahtar, imzalı URL | P0 | — | 2 | STANDARD | A | PLANNED | Bir tenant başka tenant'ın nesnesine imzalı URL üretemez | U, E, S | Orta | Öneri (onay bekliyor) |
| INF-13 | Secret yönetimi ve yapılandırma doğrulaması (prod'da secret manager) | P1 | INF-11 | 2 | CRITICAL | B | PLANNED | Eksik/zayıf secret ile uygulama açılmaz | U | Yüksek | Öneri (onay bekliyor) |

### INF-E3 Canlı öncesi güvenlik sertleştirmesi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INF-14 | Redis yüksek erişilebilirlik (replika + failover) ve alarm | P0 | INF-11 | 3 | STANDARD | B | PLANNED | Birincil Redis düşünce login/oturum < 1 dk içinde döner | Kaos testi | Yüksek (fail-closed kesinti) | Öneri (onay bekliyor) |
| INF-15 | CAPTCHA (kayıt + tekrarlı başarısız login) ve sızmış şifre kontrolü (HIBP k-anonymity) | P1 | — | 2 | STANDARD | B | PLANNED | `SECURITY.md` §4 maddeleri kapanır | U, E | Orta | Öneri (onay bekliyor) |
| INF-16 | Nonce tabanlı CSP (`unsafe-inline` kaldırılır) | P1 | — | 2 | STANDARD | B | PLANNED | `script-src` nonce'lu; sayfalar çalışır | F, P | Orta (XSS) | Öneri (onay bekliyor) |
| INF-17 | Prod ağ/TLS yapılandırması: `TRUST_PROXY`, `BFF_TRUST_PROXY`, backend yalnız iç ağ, HTTPS | P0 | INF-11 | 2 | CRITICAL | B | PLANNED | `req.ip` gerçek istemci IP'si; backend internetten erişilemez | Smoke, S | Yüksek | Öneri (onay bekliyor) |
| INF-18 | Mağaza değiştirmede Redis hatası: sahte "token hırsızlığı" audit'i ve tüm cihazlardan çıkışın önlenmesi | P0 | PR #6 merge | 2 | CRITICAL | A | DONE-MERGED (PR #10, merge `113b522`; dev `f010233`, 2026-10-30) | Switch sırasında Redis hatası → istek 503, refresh zinciri bozulmaz, `REFRESH_REUSE` audit'i yazılmaz | U, E (Redis hata enjeksiyonu) | Yüksek | Öneri (onay bekliyor) |
| INF-19 | BFF `forceRefresh` yarışı (`stillNeeded`) nedeniyle oturum kapanması | P1 | PR #6 merge | 2 | CRITICAL | B | PLANNED | Eşzamanlı iki istek tek refresh yapar, oturum açık kalır | F, P | Orta | Öneri (onay bekliyor) |
| INF-20 | Kayıtta `409` ile hesap varlığının sızması (kullanıcı numaralandırma) | P1 | USR-T9 | 1 | CRITICAL | B | PLANNED | Var olan e-postayla kayıt aynı yanıtı döner, sahibine e-posta gider | E, S | Orta | Öneri (onay bekliyor) |

## M02 — Kullanıcılar, firmalar, roller (`USR`)

### USR-E1 Firma yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USR-01 | Tenant-scoped firma (company) API | P0 | INF-02 | — | CRITICAL | A | DONE-MERGED (PR #3) | — | E | Yüksek | Onaylı plan |
| USR-02 | Firma ekranları (liste, detay, oluştur, düzenle) | P0 | USR-01, INF-07 | — | STANDARD | A | DONE-MERGED (PR #4) | — | F, P | Düşük | Onaylı plan |

### USR-E2 Kullanıcı yönetimi ve çoklu tenant üyeliği

Kaynak: `docs/superpowers/plans/2026-10-28-user-management.md` (T1–T16 numaraları korunur; tanımlar ve kabul testleri plandaki gibidir). Spec: `docs/superpowers/specs/2026-10-28-user-management-design.md`.

**MVP dilimleri (2026-10-29, kullanıcı kararı sonrası):** T9, T10, T11, T12, T13, T15 tanımları onaylı plandaki gibi korunur ve ID'leri değişmez. MVP'nin gerektirdiği en küçük parça `USR-TNa` alt görevi olarak ayrıldı (Sürüm A); orijinal satır yalnızca kalan kısmı (`T9b`…`T15b` olarak anılır) taşır ve Sürüm B'dedir. Bölme önerisi onay bekler; gerekçe: `MVP_PLAN.md` §4.

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USR-T1 | Aşama 1 migration SQL'i, ön kontroller, doğrulama sorguları (`20261029090000_tenant_memberships`) | P0 | USR-01 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | `verify-after.sql` tüm satırlar ok; rollback provası | M, E | Kritik (veri) | Onaylı plan |
| USR-T2 | Yedek ve izole prova betiği (`backup-and-rehearse.sh`), Aşama 2 SQL hazırlığı (`migrations-pending/`) | P0 | USR-T1 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | Betik çıkış 0, restore kontrolü ok | M | Yüksek | Onaylı plan |
| USR-T3 | ⛔ Onay kapısı — dev DB'de Aşama 1 | P0 | USR-T2 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | Görev yalnızca rapor üretti; dev DB migration'ı sonradan **kullanıcı onayıyla** uygulandı | M | Kritik | Onaylı plan |
| USR-T4 | Global kullanıcı modeli + üyelikle login/register | P0 | USR-T3 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | Plan T4 testleri | U, E | Yüksek | Onaylı plan |
| USR-T5 | Mağaza değiştirme ve üyelik listesi (backend + BFF + seçici) | P0 | USR-T4 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | Plan T5 testleri | U, E, F | Yüksek | Onaylı plan |
| USR-T6 | `auth_version` ile anında oturum geçersizleştirme | P0 | USR-T5 | — | CRITICAL | A | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | Plan T6 testleri | U, E | Yüksek | Onaylı plan |
| USR-17 | Güvenlik düzeltmesi: pasif / soft-delete kullanıcıya login ve refresh'te token verilmemesi, yanlış şifre audit'i arka planda | P0 | USR-T6 | — | CRITICAL | A | DONE-MERGED (PR #6, `140d348`, `946dec0`; merge `f1be19a`; dev `f010233`, 2026-10-30) | Pasif/silinmiş kullanıcı login/refresh → 401, oturumları iptal | U, E | Yüksek | PR #6 güvenlik düzeltmesi (uygulandı) |
| USR-T7 | Rol kataloğu, erişim servisi ve kurallar (`ROLE_CATALOG`, `AccessService`, `canGrant`, son owner koruması) | P0 | PR #6 merge, kullanıcı onayı | 2 | CRITICAL | A | DONE-MERGED (PR #8, merge `cc8b72a`; dev `f010233`, 2026-10-30) | Plan T7 testleri | U | Yüksek (yetki yükseltme) | Onaylı plan |
| USR-T8 | Companies modülünü firma başına role bağla; `auth/me` yetenek bayrakları | P0 | USR-T7 | 2 | CRITICAL | A | DONE-MERGED (PR #9, merge `95b5bdb`; dev `f010233`, 2026-10-30) | Plan T8 testleri (A rolü B'ye erişemez, okuma/yazma ayrımı, eski token `TOKEN_STALE`) | E, S | Yüksek | Onaylı plan |
| USR-T9 | Mail modülü ve Mailpit | P0 | PR #6 merge | 0,5 | STANDARD | B | PLANNED | Plan T9 testlerinin kalan kısmı. Kalan (USR-T9b): davet e-posta şablonu `renderInvitation` ve testleri. MVP dilimi: USR-T9a | U | Orta | Onaylı plan |
| USR-T9a | Mail modülü çekirdeği: `MailService.send`, SMTP/log transport, `mail.config` (prod'da `log` yasak, TLS zorunlu), Mailpit (docker), URL/token loglanmaz | P0 | PR #6 merge | 1,5 | STANDARD | A | DONE-MERGED (PR #12, merge `f9b5889`; dev `f010233`, 2026-10-30) | Plan T9 testleri (şablon testi hariç); USR-19 ve USR-T10a bunu kullanır | U | Orta | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T10 | Davet servisi (oluştur, yeniden gönder, iptal, lookup, kabul) | P0 | USR-T7, USR-T9 | 1 | CRITICAL | B | PLANNED | Plan T10 testlerinin kalan kısmı. Kalan (USR-T10b): `GET /invitations?status=` filtresi, `accept-as-current`, pasif üyeliği davetle yeniden açma (`replacesInactiveMembership`), resend hız sınırları. MVP dilimi: USR-T10a | E, S | Yüksek | Onaylı plan |
| USR-T10a | Davet servisi çekirdeği: oluştur (Admin / firma rolleri), iptal, yeniden gönder (yeni token), lookup, kabul (yeni hesap; mevcut hesap şifreyle) | P0 | USR-T7, USR-T9a | 3 | CRITICAL | A | DONE-MERGED (PR #15, merge `bc37227`; dev `f010233`, 2026-10-30) | Plan T10 testleri; `accept-as-current` ve pasif üyelik değiştirme testleri hariç (T10b). Pasif üyeliği olan e-postaya davet MVP'de `409` (yeniden aktifleştirme T11a ile) | E, S | Yüksek | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T11 | Users modülü (liste, erişim düzenleme, pasife alma) | P0 | USR-T8, USR-T10 | 0,5 | CRITICAL | B | PLANNED | Plan T11 testlerinin kalan kısmı. Kalan (USR-T11b): `GET /users/:userId` detay, `lastLoginAt`. MVP dilimi: USR-T11a | E, S | Yüksek | Onaylı plan |
| USR-T11a | Users modülü çekirdeği: `GET /users`, `PUT /users/:userId/access`, `POST /users/:userId/deactivate` / `activate` (T6 `bumpAuthVersion` + refresh iptali), audit | P0 | USR-T8, USR-T10a | 2,5 | CRITICAL | A | DONE-MERGED (PR #19, merge `8fc7ae3`; dev `8fc7ae3`, 2026-10-30) | Plan T11 testleri (detay/`lastLoginAt` hariç); pasife alınan personelin sonraki isteği `SESSION_REVOKED`. Owner politikası (kullanıcı kararı 2026-10-30): owner'ın rolü/erişimi değiştirilemez; son aktif owner değilse pasife alınabilir; son owner koruması eşzamanlı isteklerde de geçerli. Sahiplik devri USR-21 | E, S | Yüksek | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T12 | BFF route'ları (kullanıcı/davet allowlist, oturumsuz davet route'ları) | P0 | USR-T11 | 0,5 | CRITICAL | B | PLANNED | Plan T12 testlerinin kalan kısmı. Kalan (USR-T12b): resend ve durum filtreli davet listesi route'ları, oturum açıkken `accept-as-current` dalı. MVP dilimi: USR-T12a | F | Orta | Onaylı plan |
| USR-T12a | BFF route'ları çekirdeği: users + invitations (oluştur, iptal) allowlist, `PUT`, oturumsuz `invitations/lookup` ve `accept`, `/invite/*` için `Referrer-Policy: no-referrer` | P0 | USR-T11a | 0,5 | CRITICAL | A | PLANNED | Plan T12 testleri | F | Orta | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T13 | Kullanıcılar sayfası, davet diyaloğu, davet kabul sayfası | P0 | USR-T12 | 1 | STANDARD | B | PLANNED | Plan T13 testlerinin kalan kısmı. Kalan (USR-T13b): bekleyen davetler paneli, `signedInSameEmail`/`signedInOtherEmail` durumları, "mağazaya geç" düğmesi, mobil kart görünümü. MVP dilimi: USR-T13a | F, P | Düşük | Onaylı plan |
| USR-T13a | Kullanıcılar sayfası (masaüstü tablo), davet diyaloğu + erişim düzenleyici, pasife al/aktifleştir; davet kabul sayfası (`loading`, `invalid`, `newAccount`, `existingAccount`, `done`) | P0 | USR-T12a | 2 | STANDARD | A | PLANNED | lint + typecheck; davranış USR-T15a'da | F, P | Düşük | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T14 | Yetki yükseltme ve tenant izolasyonu test paketi | P0 | USR-T11a, USR-T10a | 2 | CRITICAL | A | PLANNED | Plan T14 maddeleri PASS (MVP dilimlerinin uçları: users, invitations, access, deactivate) | S, E | Yüksek | Onaylı plan |
| USR-T15 | Playwright akışları (davet, erişim, mağaza değiştirme, mobil) | P1 | USR-T13 | 1 | STANDARD | B | PLANNED | Plan T15 testlerinin kalan kısmı. Kalan (USR-T15b): başka mağazadaki mevcut kullanıcının kabul + isteğe bağlı mağaza değiştirme, açık sekmede rol değişikliği, mobil kart testleri. MVP dilimi: USR-T15a | P | Düşük | Onaylı plan |
| USR-T15a | Playwright çekirdek akışlar: owner muhasebeciyi A firmasına davet eder, davetli yalnızca A'yı görür; iptal edilen bağlantı geçersiz sayfası; pasife alınan kullanıcı sonraki işlemde çıkış yapar | P1 | USR-T13a | 1 | STANDARD | A | PLANNED | 2 ardışık koşuda PASS | P | Düşük | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T16 | Tam doğrulama ve PR | P0 | USR-T14, USR-T15a | 1 | STANDARD | A | PLANNED | Plan T16 adımları (MVP dilimleri için; T9b–T15b B'de ayrı PR) | Tümü | Düşük | Onaylı plan |
| USR-18 | Aşama 2 migration: `users.tenant_id` / `users.is_active` eski kolonlarını kaldırma; önce guard ve login/refresh'in `users.is_active` okuması yeni modele taşınır | P1 | USR-T16, kullanıcı onayı | 3 | CRITICAL | B | BLOCKED (T16 + ayrı migration onayı) | `user-state.ts`, guard ve auth repository kolonu okumaz; prova + verify ok; rollback provası | M, U, E | Kritik (veri, erişim) | Öneri (onay bekliyor) |

### USR-E3 Hesap güvenliği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| USR-19 | Şifre sıfırlama ve e-posta doğrulama (hash'li tek kullanımlık token) | P0 | USR-T9a | 3 | CRITICAL | A | PLANNED | Token tek kullanımlık, süreli; sıfırlama tüm oturumları düşürür; yanıt hesap varlığını sızdırmaz | E, S | Yüksek | Öneri (onay bekliyor) |
| USR-20 | İki adımlı doğrulama (TOTP) ve kurtarma kodları | P2 | USR-19 | 3 | CRITICAL | B | PLANNED | Owner/admin için zorunlu kılınabilir | U, E | Orta | Öneri (onay bekliyor) |
| USR-21 | Sahiplik devri: owner rolünü başka bir aktif üyeye devretme (devreden onayı, yeniden kimlik doğrulama, audit, son owner koruması) | P2 | USR-T11a | 1,5 | CRITICAL | B | PLANNED | Devir tek işlemde; devir sırasında mağaza hiçbir an owner'sız kalmaz; eşzamanlı devir/pasife alma güvenli | E, S | Yüksek | Kullanıcı kararı (2026-10-30) |

## M03 — Dashboard (`DSH`)

### DSH-E1 Dashboard

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DSH-01 | Uygulama kabuğu ve dashboard iskeleti | P1 | INF-07 | — | FAST | A | DONE-MERGED (PR #4) | — | P | Düşük | Onaylı plan |
| DSH-02 | KPI kartları: günlük sipariş, ciro, bekleyen kargo, düşük stok, entegrasyon hataları | P1 | ORD-02, INV-01, INT-03 | 3 | STANDARD | B | PLANNED | Değerler rapor sorgularıyla aynı; firma rolüne göre filtreli | E, P | Düşük | Öneri (onay bekliyor) |
| DSH-03 | Bildirim merkezi (uygulama içi + e-posta tercihleri) | P2 | INF-09, USR-T9 | 3 | STANDARD | B | PLANNED | Bildirim yalnızca yetkili kullanıcıya | E | Düşük | Öneri (onay bekliyor) |

## M04 — Ürün kataloğu (`CAT`)

### CAT-E1 Katalog çekirdeği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CAT-01 | Katalog şeması: kategori, marka, ürün, varyant, barkod/SKU (tenant + firma kapsamlı) | P0 | PR #6 merge (USR-T7/T8 ile paralel) | 3 | CRITICAL | A | DONE-MERGED (PR #13, merge `aa02144`; dev `f010233`, 2026-10-30) | Composite tenant FK'leri; SKU tenant içinde tekil; migration provası | M, E | Yüksek (izolasyon) | Öneri (onay bekliyor) |
| CAT-02 | Ürün CRUD API (liste, filtre, sayfalama, soft-delete, audit) | P0 | CAT-01; merge öncesi USR-T8 (firma izin kontrolü) | 3 | STANDARD | A | DONE-MERGED (PR #16, merge `6824f6f`; dev `f010233`, 2026-10-30) | Firma rolü izinleri uygulanır; pasif firmanın ürünleri yazılamaz (`409 COMPANY_INACTIVE`) | E, S | Orta | Öneri (onay bekliyor) |
| CAT-03 | Varyant ve özellik (attribute) yönetimi | P0 | CAT-02 | 4 | STANDARD | A | PLANNED | Renk/beden gibi eksenlerden varyant üretimi | U, E | Düşük | Öneri (onay bekliyor) |
| CAT-04 | Katalog UI: liste, filtre, ürün formu, varyant editörü | P0 | CAT-03 | 4 | STANDARD | A | PLANNED | Mobilde kullanılabilir | F, P | Düşük | Öneri (onay bekliyor) |
| CAT-05 | Fiyat yönetimi: liste fiyatı, kanal fiyatı, KDV oranı (`decimal` + para birimi) | P0 | CAT-02 | 2 | STANDARD | A | PLANNED | Float yok; yuvarlama kuralı belgelendi | U, E | Orta (finansal doğruluk) | Öneri (onay bekliyor) |

### CAT-E2 Pazaryeri kategori/özellik eşleme

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CAT-06 | Kanal kategori ağacı ve zorunlu özellik eşleme modeli + UI | P0 | CAT-02, INT-01 (CAT-03 ile paralel; varyant özellik eşlemesi INT-TY-01'de tamamlanır) | 4 | STANDARD | A | PLANNED | Eksik zorunlu özellik listeleme öncesi gösterilir | U, E | Düşük | Öneri (onay bekliyor) |

## M05 — AI destekli ürün yükleme (`AIU`)

`ai-engine` bağımsızdır: katalog verisini doğrudan okumaz; çağıran modül veriyi istek içinde verir, öneri döner, kullanıcı onaylar.

### AIU-E1 AI ile ürün içeriği

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AIU-01 | Başlık/açıklama/anahtar kelime önerisi (pazaryeri kurallarına göre), onaylı uygulama | P2 | AIE-01, CAT-04 | 3 | STANDARD | C | PLANNED | Öneri onaysız kaydedilmez; maliyet tenant kotasına yazılır | U, E | Orta (prompt injection) | Öneri (onay bekliyor) |
| AIU-02 | Görselden özellik çıkarma (renk, materyal, kategori önerisi) | P3 | AIE-01, IMG-01 | 3 | STANDARD | C | PLANNED | Güven skoru düşükse öneri işaretlenir | U | Orta | Öneri (onay bekliyor) |
| AIU-03 | Toplu AI zenginleştirme (içe aktarılan ürünler için kuyrukta) | P3 | AIU-01, IMP-02 | 2 | STANDARD | C | PLANNED | Kota aşımında iş durur, kısmi sonuç raporlanır | E | Orta | Öneri (onay bekliyor) |

## M06 — Toplu içe aktarma: Excel/CSV ve URL (`IMP`)

### IMP-E1 Toplu içe/dışa aktarma

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IMP-01 | Excel/CSV şablonu, satır doğrulama, deneme (dry-run) raporu | P0 | CAT-03 | 3 | STANDARD | A | PLANNED | Hatalı satırlar satır/kolon bazında raporlanır; formül enjeksiyonu (CSV injection) engellenir | U, E | Orta | Öneri (onay bekliyor) |
| IMP-02 | Asenkron içe aktarma işi (kuyruk), ilerleme ve hata raporu indirme | P0 | IMP-01, INF-09 | 3 | STANDARD | B | PLANNED | 10.000 satır zaman aşımına düşmeden işlenir; yarıda kalan iş yeniden başlatılabilir | E, L | Orta | Öneri (onay bekliyor) |
| IMP-03 | URL'den ürün içe aktarma (sayfa/feed çekme) | P2 | IMP-02 | 4 | CRITICAL | B | PLANNED | SSRF koruması: özel IP/metadata adresleri reddedilir, boyut/süre sınırı, yönlendirme kontrolü | U, S | Yüksek (SSRF) | Öneri (onay bekliyor) |
| IMP-04 | Toplu dışa aktarma (ürün, stok, fiyat) | P2 | IMP-01 | 2 | FAST | B | PLANNED | Yalnızca kullanıcının yetkili firmaları | E | Düşük | Öneri (onay bekliyor) |

## M07 — Ürün görsel yönetimi (`IMG`)

### IMG-E1 Görseller

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| IMG-01 | Görsel yükleme, sıralama, ürün/varyanta bağlama | P0 | INF-12, CAT-02 | 3 | STANDARD | A | PLANNED | MIME içerikten doğrulanır, boyut sınırı, EXIF temizlenir | U, E, S | Orta (dosya yükleme) | Öneri (onay bekliyor) |
| IMG-02 | Yeniden boyutlandırma/türev üretimi ve pazaryeri görsel kurallarına uygunluk kontrolü | P1 | IMG-01, INF-09 | 2 | STANDARD | B | PLANNED | Kural ihlali listeleme öncesi gösterilir | U | Düşük | Öneri (onay bekliyor) |
| IMG-03 | AI arka plan temizleme / beyaz fon | P3 | IMG-02, AIE-01 | 2 | FAST | C | PLANNED | Orijinal korunur | U | Düşük | Öneri (onay bekliyor) |

## M08 — Pazaryeri API entegrasyonları (`INT`)

Her pazaryeri ayrı EPIC'tir ve ortak çerçeveyi (`INT-E0`) kullanır. Her pazaryeri için 3 görev: (1) bağlantı + ürün/listeleme, (2) stok ve fiyat senkronu, (3) sipariş, kargo, iptal/iade senkronu. Hakediş/finans API'leri `STL` modülündedir.

**Ortak kabul kriterleri (tüm pazaryeri görevleri):** sandbox/test hesabında uçtan uca senaryo; kimlik bilgileri şifreli saklanır ve loglanmaz; API rate limit'ine uyulur; geçici hatalar backoff ile yeniden denenir; her senkron idempotent; sözleşme testleri kayıtlı yanıtlarla (fixture) çalışır.

### INT-E0 Ortak entegrasyon çerçevesi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-01 | `ChannelAdapter` arayüzü, kanal hesabı modeli, kimlik bilgisi şifreleme (envelope encryption, anahtar rotasyonu) | P0 | USR-T8, INF-13 (dev'de yerel anahtar) | 4 | CRITICAL | A | PLANNED | Kimlik bilgisi DB'de düz metin değil; API yanıtlarında maskeli | U, E, S | Kritik (müşteri API anahtarları) | Öneri (onay bekliyor) |
| INT-02 | Senkron motoru: kanal başına rate limiter, retry, idempotency, senkron logu, çakışma çözümü | P0 | INT-01, INF-09 | 5 | CRITICAL | A | PLANNED | Aynı sipariş iki kez içeri alınmaz; başarısız iş görünür ve yeniden denenebilir | U, E | Yüksek | Öneri (onay bekliyor) |
| INT-03 | Entegrasyon yönetim UI: bağla, test et, durum, hata logu | P0 | INT-01 | 3 | STANDARD | A | PLANNED | Yalnızca yetkili roller kimlik bilgisi girer/görür (maskeli) | F, P | Orta | Öneri (onay bekliyor) |
| INT-04 | Webhook alıcısı (imza doğrulama, tekrar oynatma koruması) | P1 | INT-02 | 2 | CRITICAL | B | PLANNED | İmzasız/eski istek reddedilir | U, E, S | Yüksek | Öneri (onay bekliyor) |

### INT-E1 Trendyol

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-TY-01 | Trendyol bağlantısı + ürün oluşturma/güncelleme, batch durum takibi | P0 | INT-02, CAT-06, CAT-03, IMG-01 | 5 | STANDARD | A | PLANNED | Stage ortamında ürün onaya gönderilir, batch sonucu ürüne işlenir; görseller Trendyol'un erişebileceği kalıcı (süresi dolmayan) HTTPS URL ile gönderilir (IMG-02 B'de) | U, E | Orta | Öneri (onay bekliyor) |
| INT-TY-02 | Trendyol stok ve fiyat senkronu | P0 | INT-TY-01, INV-02 | 3 | STANDARD | A | PLANNED | Stok değişimi ≤ 5 dk içinde kanala yansır | U, E | Orta | Öneri (onay bekliyor) |
| INT-TY-03 | Trendyol sipariş çekme, paket durumu, kargo bilgisi, iptal (tedarik edememe) ve iade (claim) senkronu, yerel stok iadesi | P0 | INT-TY-01, ORD-02, INV-02 | 6 | STANDARD | A | PLANNED | Sipariş idempotent içeri alınır; durum güncellemeleri kanala gönderilir; Trendyol'dan gelen müşteri iptali (`Cancelled`) ve satıcı tedarik edememe bildirimi (`unsupplied`) rezervasyonu/düşümü geri alan stok hareketi üretir; claim listesi (`getClaims`) çekilir, `WaitingInAction` kalemleri onaylanır (`approveClaimLineItems`) veya ret talebi açılır (`createClaimIssue`); onaylanan iade kalemi yalnızca bir kez stok girişi hareketi üretir (idempotent). Ayrıntılı iade UI ve manuel iade SHP-01'de (B) | U, E | Orta | Öneri (onay bekliyor) |

### INT-E2 Hepsiburada

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-HB-01 | Hepsiburada bağlantısı + listeleme/katalog eşleme | P1 | INT-02, CAT-06 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-HB-02 | Hepsiburada stok ve fiyat senkronu | P1 | INT-HB-01, INV-02 | 3 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-HB-03 | Hepsiburada sipariş, paketleme, kargo, iptal/iade | P1 | INT-HB-01, ORD-02 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |

### INT-E3 Amazon Türkiye

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-AMZ-01 | Amazon SP-API bağlantısı (LWA OAuth, uygulama kaydı) + listeleme (Listings/Feeds) | P1 | INT-02, CAT-06 | 6 | CRITICAL | B | PLANNED | OAuth refresh token şifreli; ürün tipi şeması doğrulanır | U, E, S | Yüksek (OAuth) | Öneri (onay bekliyor) |
| INT-AMZ-02 | Amazon stok ve fiyat senkronu | P1 | INT-AMZ-01, INV-02 | 4 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-AMZ-03 | Amazon sipariş (PII için kısıtlı veri erişimi), kargo onayı, iade | P1 | INT-AMZ-01, ORD-02 | 5 | CRITICAL | B | PLANNED | PII yalnızca gereken süre saklanır (Amazon veri koruma politikası) | U, E, S | Yüksek (PII) | Öneri (onay bekliyor) |

### INT-E4 n11

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-N11-01 | n11 bağlantısı + ürün/listeleme | P1 | INT-02, CAT-06 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-N11-02 | n11 stok ve fiyat senkronu | P1 | INT-N11-01, INV-02 | 3 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-N11-03 | n11 sipariş, kargo, iptal/iade | P1 | INT-N11-01, ORD-02 | 5 | STANDARD | B | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |

### INT-E5 Pazarama

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-PZR-01 | Pazarama bağlantısı + ürün/listeleme | P2 | INT-02, CAT-06 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-PZR-02 | Pazarama stok ve fiyat senkronu | P2 | INT-PZR-01, INV-02 | 3 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-PZR-03 | Pazarama sipariş, kargo, iptal/iade | P2 | INT-PZR-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |

### INT-E6 ÇiçekSepeti

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-CS-01 | ÇiçekSepeti bağlantısı + ürün/listeleme | P2 | INT-02, CAT-06 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-CS-02 | ÇiçekSepeti stok ve fiyat senkronu | P2 | INT-CS-01, INV-02 | 3 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-CS-03 | ÇiçekSepeti sipariş, kargo, iptal/iade | P2 | INT-CS-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |

### INT-E7 Temu

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INT-TEMU-01 | Temu satıcı API bağlantısı + ürün/listeleme (TR satıcı API erişimi doğrulanmalı) | P3 | INT-02, CAT-06 | 6 | STANDARD | C | PLANNED | Ortak kriterler; API erişimi yoksa BLOCKED | U, E | Orta | Öneri (onay bekliyor) |
| INT-TEMU-02 | Temu stok ve fiyat senkronu | P3 | INT-TEMU-01, INV-02 | 4 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |
| INT-TEMU-03 | Temu sipariş, kargo, iptal/iade | P3 | INT-TEMU-01, ORD-02 | 5 | STANDARD | C | PLANNED | Ortak kriterler | U, E | Orta | Öneri (onay bekliyor) |

## M09 — Siparişler (`ORD`)

### ORD-E1 Sipariş yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ORD-01 | Sipariş şeması: sipariş, kalem, durum geçmişi, kanal referansı (tekil `channel + external_id`) | P0 | CAT-01 | 2 | CRITICAL | A | PLANNED | Tutarlar `decimal`; kanal sipariş no tenant içinde tekil; migration provası | M, E | Yüksek | Öneri (onay bekliyor) |
| ORD-02 | Sipariş API ve durum makinesi (geçersiz geçiş reddi, audit) | P0 | ORD-01 | 4 | STANDARD | A | PLANNED | Tüm geçişler test edilmiş tabloyla | U, E | Orta | Öneri (onay bekliyor) |
| ORD-03 | Sipariş UI: liste, filtre, detay, toplu işlem (etiket yazdır, durum) | P0 | ORD-02 | 3 | STANDARD | A | PLANNED | Mobilde kart görünümü | F, P | Düşük | Öneri (onay bekliyor) |
| ORD-04 | Manuel / telefonla sipariş girişi | P2 | ORD-02, CRM-01 | 2 | FAST | B | PLANNED | Stok düşümü otomatik | E | Düşük | Öneri (onay bekliyor) |

## M10 — Stok ve depo (`INV`)

### INV-E1 Stok yönetimi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INV-01 | Depo ve stok şeması; append-only stok hareketleri | P0 | CAT-01 | 3 | CRITICAL | A | PLANNED | Stok = hareketlerin toplamı; hareket silinemez | M, E | Orta | Öneri (onay bekliyor) |
| INV-02 | Rezervasyon ve sipariş bağlı düşüm (eşzamanlılık güvenli) | P0 | INV-01, ORD-01 | 4 | CRITICAL | A | PLANNED | Paralel siparişlerde negatif stok oluşmaz (satır kilidi/koşullu güncelleme) | U, E, L | Orta (veri bütünlüğü) | Öneri (onay bekliyor) |
| INV-03 | Stok UI, düşük stok eşiği ve uyarısı | P1 | INV-01 | 2 | STANDARD | A | PLANNED | Eşik altı ürünler listelenir | F, P | Düşük | Öneri (onay bekliyor) |
| INV-04 | Çoklu depo transferi ve stok sayımı | P2 | INV-02 | 3 | STANDARD | B | PLANNED | Transfer iki hareket olarak kaydedilir | E | Düşük | Öneri (onay bekliyor) |

## M11 — Kargo, iptal ve iade (`SHP`)

### SHP-E1 Kargo ve iade süreçleri

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SHP-01 | İptal ve iade akışı: talep, onay/ret, stok iadesi, kanal bildirimi | P0 | ORD-02, INV-02 | 4 | STANDARD | B | PLANNED | İade stok hareketi üretir; kanal durumu senkron. B kapsamı: çok kanallı genel iptal/iade iş akışı, manuel iade, iade UI. Trendyol iptal/iade senkronu ve stok iadesi MVP'de INT-TY-03 içindedir | U, E | Orta | Öneri (onay bekliyor) |
| SHP-02 | Pazaryeri kargo entegrasyonu üzerinden etiket ve takip numarası | P0 | ORD-03, INT-TY-03 | 3 | STANDARD | A | PLANNED | Etiket PDF indirilir, takip no siparişe işlenir | E, P | Düşük | Öneri (onay bekliyor) |
| SHP-03 | Anlaşmalı kargo firmaları API'leri (ör. Yurtiçi, Aras, MNG) | P2 | SHP-02, INT-01 | 5 | STANDARD | B | PLANNED | En az 2 firma; kimlik bilgileri INT-01 ile saklanır | U, E | Orta | Öneri (onay bekliyor) |

## M12 — e-Fatura / e-Arşiv ve muhasebe (`EFT`)

### EFT-E1 e-Belge

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EFT-01 | Özel entegratör adapter soyutlaması + ilk entegratör (sözleşme ve test hesabı gerekir) | P0 | INT-01, ORD-02 | 4 | CRITICAL | B | PLANNED | Entegratör kimlik bilgileri şifreli; test ortamında bağlantı | U, E, S | Yüksek (yasal belge) | Öneri (onay bekliyor) |
| EFT-02 | Siparişten e-Arşiv / e-Fatura kesimi (mükellef sorgusu, seri/numara, KDV) | P0 | EFT-01 | 5 | CRITICAL | B | PLANNED | Aynı sipariş için çift fatura kesilemez; tutarlar siparişle birebir | U, E | Yüksek | Öneri (onay bekliyor) |
| EFT-03 | Fatura iptali ve iade faturası | P1 | EFT-02, SHP-01 | 3 | CRITICAL | B | PLANNED | Yasal süre kuralları uygulanır | U, E | Yüksek | Öneri (onay bekliyor) |
| EFT-04 | Faturanın pazaryerine iletilmesi (link/PDF) | P1 | EFT-02, INT-TY-03 | 2 | STANDARD | B | PLANNED | Trendyol ve HB'de fatura siparişe bağlanır | E | Düşük | Öneri (onay bekliyor) |
| EFT-05 | Muhasebe dışa aktarımı (ör. Logo, Mikro, Paraşüt formatları) | P3 | EFT-02 | 4 | STANDARD | C | PLANNED | En az 1 format | U | Düşük | Öneri (onay bekliyor) |

## M13 — Müşteriler ve tedarikçiler (`CRM`)

### CRM-E1 Müşteri ve tedarikçi

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CRM-01 | Müşteri modeli (siparişten türetme, adres), KVKK alan maskeleme | P1 | ORD-01 | 2 | CRITICAL | B | PLANNED | Kişisel veri yetkisiz rollere maskeli; loglara yazılmaz | E, S | Yüksek (KVKK) | Öneri (onay bekliyor) |
| CRM-02 | Müşteri UI: liste, detay, sipariş geçmişi | P2 | CRM-01 | 2 | FAST | B | PLANNED | — | F | Düşük | Öneri (onay bekliyor) |
| CRM-03 | Tedarikçi ve satın alma siparişi (stok girişine bağlı) | P2 | INV-01 | 4 | STANDARD | B | PLANNED | Mal kabul stok hareketi üretir | E | Düşük | Öneri (onay bekliyor) |

## M14 — Kampanya ve reklam (`CMP`)

### CMP-E1 Kampanya ve reklam

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CMP-01 | Kanal kampanya/indirim yönetimi (planlı fiyat değişimi, geri alma) | P2 | CAT-05, INT-TY-02 | 4 | STANDARD | B | PLANNED | Kampanya bitince fiyat otomatik geri döner | U, E | Orta (yanlış fiyat) | Öneri (onay bekliyor) |
| CMP-02 | Reklam harcaması içe aktarma (kanal reklam API'leri / dosya) | P3 | INT-02 | 3 | STANDARD | C | PLANNED | Harcama ürün/kampanyaya bağlanır | U | Düşük | Öneri (onay bekliyor) |
| CMP-03 | AI kampanya optimizasyon önerisi (bütçe, indirim oranı) | P3 | CMP-02, PRF-02, AIE-01 | 4 | STANDARD | C | PLANNED | Yalnızca öneri; onaysız uygulanmaz | U | Orta | Öneri (onay bekliyor) |

## M15 — Kârlılık ve gider hesaplama (`PRF`)

### PRF-E1 Kârlılık

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PRF-01 | Maliyet ve gider modeli: ürün maliyeti, komisyon tablosu, kargo, sabit gider dağıtımı | P1 | CAT-05, ORD-01 | 3 | STANDARD | B | PLANNED | Tüm tutarlar `decimal`; tarih aralıklı komisyon | U, E | Orta | Öneri (onay bekliyor) |
| PRF-02 | Sipariş ve ürün bazlı kâr hesaplama (iade/iptal etkisi dahil) | P1 | PRF-01, SHP-01 | 4 | STANDARD | B | PLANNED | Örnek veri setinde elle hesapla birebir | U | Orta (finansal doğruluk) | Öneri (onay bekliyor) |
| PRF-03 | Kârlılık raporu UI (ürün, kanal, dönem) | P1 | PRF-02 | 3 | STANDARD | B | PLANNED | — | F, P | Düşük | Öneri (onay bekliyor) |

## M16 — Hakediş ve mutabakat (`STL`)

### STL-E1 Hakediş

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| STL-01 | Hakediş/finans verisi çekme (Trendyol, Hepsiburada finans API'leri) | P1 | INT-TY-03, INT-HB-03 | 5 | STANDARD | B | PLANNED | Ödeme kalemleri siparişlere bağlanır | U, E | Orta | Öneri (onay bekliyor) |
| STL-02 | Mutabakat motoru: beklenen (sipariş − komisyon − kesinti) vs ödenen | P1 | STL-01, PRF-01 | 4 | STANDARD | B | PLANNED | Fark kuruş düzeyinde doğru | U | Orta | Öneri (onay bekliyor) |
| STL-03 | Fark raporu ve UI | P1 | STL-02 | 3 | STANDARD | B | PLANNED | — | F, P | Düşük | Öneri (onay bekliyor) |

## M17 — Raporlama (`RPT`)

### RPT-E1 Raporlar

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RPT-01 | Satış raporları (dönem, kanal, ürün) | P1 | ORD-02 | 3 | STANDARD | A | PLANNED | Firma rolüne göre filtreli | E | Düşük | Öneri (onay bekliyor) |
| RPT-02 | Stok raporları (değer, devir, stoksuz kalma) | P1 | INV-02 | 2 | STANDARD | B | PLANNED | — | E | Düşük | Öneri (onay bekliyor) |
| RPT-03 | Excel/PDF dışa aktarma ve zamanlanmış e-posta raporu | P2 | RPT-01, INF-09, USR-T9 | 3 | STANDARD | B | PLANNED | Rapor yalnızca yetkili alıcıya | E | Düşük | Öneri (onay bekliyor) |
| RPT-04 | Gelişmiş analitik (kanal karşılaştırma, kohort, trend) | P3 | RPT-01, PRF-02 | 5 | STANDARD | C | PLANNED | Ağır sorgular okuma replikasında/ön-hesaplı | E, L | Düşük | Öneri (onay bekliyor) |

## M18 — AI asistan ve otomasyonlar (`AIE`)

`ai-engine` diğer modüllerden bağımsızdır (AGENTS.md): kendi tablolarını kullanır, diğer modüllerin tablolarını okumaz; veri, açık bir sözleşmeyle (istek gövdesi veya diğer modüllerin yayınladığı salt-okunur servis arayüzü) gelir; çıktısı öneridir, kullanıcı onayı olmadan veri değiştirmez.

### AIE-E1 AI motoru ve otomasyon

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AIE-01 | `ai-engine` çekirdeği: LLM sağlayıcı soyutlaması, tenant kotası/maliyet takibi, prompt injection ve veri sızıntısı koruması | P1 | INF-09 | 5 | CRITICAL | C | PLANNED | Modül başka modül tablosuna erişmez (mimari testi); istek başka tenant verisi içeremez | U, S | Yüksek | Öneri (onay bekliyor) |
| AIE-02 | AI asistan (sohbet): salt-okunur, kullanıcının yetkisiyle sınırlı sorular | P2 | AIE-01, RPT-01 | 5 | CRITICAL | C | PLANNED | Asistan kullanıcının göremediği veriyi döndüremez | S, E | Yüksek | Öneri (onay bekliyor) |
| AIE-03 | Kural tabanlı otomasyonlar (fiyat/stok kuralları; öneri → onay → uygula) | P2 | AIE-01, INT-TY-02 | 5 | STANDARD | C | PLANNED | Onaysız değişiklik yok; her uygulama audit'li | U, E | Orta | Öneri (onay bekliyor) |
| AIE-04 | Satış tahmini ve stok yenileme önerisi | P3 | AIE-01, RPT-02 | 5 | STANDARD | C | PLANNED | Geri test (backtest) metrikleri raporlanır | U | Düşük | Öneri (onay bekliyor) |

## M19 — Abonelik ve ödeme (`SUB`)

### SUB-E1 Abonelik

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SUB-01 | Plan/paket ve limit modeli (kanal sayısı, ürün, kullanıcı) | P0 | PR #6 merge | 2 | CRITICAL | B | PLANNED | Plan değişikliği audit'li | U, E | Orta | Öneri (onay bekliyor) |
| SUB-02 | Ödeme sağlayıcı entegrasyonu (ör. iyzico/PayTR; kart saklama sağlayıcıda, tokenization) | P0 | SUB-01 | 5 | CRITICAL | B | PLANNED | Kart verisi sistemimize girmez (PCI kapsamı dışı); webhook imzalı | U, E, S | Kritik (ödeme) | Öneri (onay bekliyor) |
| SUB-03 | Faturalama döngüsü: deneme süresi, yenileme, başarısız ödeme takibi (dunning), abonelik faturası | P0 | SUB-02, EFT-02 | 4 | CRITICAL | B | PLANNED | Çift tahsilat olmaz (idempotent) | U, E | Yüksek | Öneri (onay bekliyor) |
| SUB-04 | Limit uygulama (feature gating) ve plan aşımı uyarısı | P1 | SUB-01 | 3 | STANDARD | B | PLANNED | Limit hem API'de hem UI'da uygulanır | E | Orta | Öneri (onay bekliyor) |

## M20 — Sistem yönetimi, izleme ve güvenlik (`OPS`)

### OPS-E1 İzleme, yedekleme, performans

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| OPS-01 | Yapılandırılmış log + hata izleme (ör. Sentry), istek kimliği | P0 | — | 2 | STANDARD | A | PLANNED | Loglarda kişisel veri/secret yok (otomatik maskeleme testi) | U | Orta | Öneri (onay bekliyor) |
| OPS-02 | Metrikler, uptime ve alarm (DB, Redis, kuyruk, entegrasyon hata oranı) | P0 | OPS-01, INF-11 | 3 | STANDARD | B | PLANNED | Alarm kanalı test edildi | Smoke | Orta | Öneri (onay bekliyor) |
| OPS-03 | Otomatik yedekleme ve geri yükleme (PITR), geri yükleme tatbikatı | P0 | — | 3 | CRITICAL | A | PLANNED | Belgelenmiş RPO/RTO; tatbikat başarılı | M | Kritik | Öneri (onay bekliyor) |
| OPS-06 | Yük ve performans testi (senkron, sipariş içeri alma, raporlar) | P1 | INF-11 | 3 | STANDARD | B | PLANNED | Hedef p95 süreleri belgelendi ve karşılandı | L | Orta | Öneri (onay bekliyor) |
| OPS-08 | `backup-and-rehearse.sh` genelleştirme: başlangıç noktası hedef DB'nin son uygulanmış migration'ından otomatik; yalnızca bekleyen migration'ların kontrolleri (migration klasöründe `verify.sql`); `down.sql` provası (boş ve dolu veriyle durma koşulu); Aşama 1 kontrolleri yalnızca Aşama 1 bekliyorken | P1 | — | 1 | STANDARD | A | PLANNED | Dev'in mevcut durumunda (CAT-01 uygulanmış) betik çıkış 0 verir; bekleyen migration yoksa açıkça bunu raporlar; CAT-01 benzeri yeni bir migration için `verify.sql` kontrolleri ve `down.sql` provası raporda görünür; hiçbir aşamada kaynak DB'ye yazılmaz (yalnızca `pg_dump`); `tm_` dışı DB oluşturulmaz/silinmez; rapor satır içeriği içermez | M (izole) | Orta (yanlış prova güveni) | Kullanıcı kararı (2026-10-30) |

### OPS-E2 Yönetim ve uyum

| ID | Görev | Öncelik | Bağımlılık | Tahmin | Mod | Sürüm | Durum | Kabul kriteri | Test | Güvenlik riski | Kaynak |
|---|---|---|---|---|---|---|---|---|---|---|---|
| OPS-04 | Sistem yöneticisi (süper admin) paneli: tenant listesi, askıya alma, süreli ve audit'li destek erişimi | P1 | USR-T11, SUB-01 | 5 | CRITICAL | B | PLANNED | Destek erişimi tenant onaylı, süreli, audit'li; normal kullanıcı erişemez | E, S | Kritik | Öneri (onay bekliyor) |
| OPS-05 | KVKK: veri dışa aktarma/silme talebi, saklama süreleri, aydınlatma metni | P0 | CRM-01, USR-T11 | 4 | CRITICAL | B | PLANNED | Silme talebi audit bütünlüğünü bozmadan anonimleştirir | E | Yüksek | Öneri (onay bekliyor) |
| OPS-07 | Bağımsız güvenlik denetimi / sızma testi ve bulguların kapatılması | P0 | B sürümü özellik tamamlığı | 4 | CRITICAL | B | PLANNED | Kritik/yüksek bulgu kalmaz | S | Yüksek | Öneri (onay bekliyor) |

## Sürümlere göre görev listeleri

### Sürüm A — MVP: Trendyol-only (58 görev: 28 tamamlandı + 30 kalan; kalan tahmin 87,5 iş günü; 18 EPIC)

| ID | Görev | Durum | Tahmin | Mod | Kaynak |
|---|---|---|---|---|---|
| INF-01 | Docker dev ortamı (PostgreSQL 16, Redis 7) | DONE-MERGED (PR #1) | — | FAST | Onaylı plan |
| INF-02 | NestJS + Prisma iskeleti, Prisma tenant izolasyon eklentisi, auth modülü | DONE-MERGED (PR #1) | — | CRITICAL | Onaylı plan |
| INF-03 | Append-only, tenant-scoped audit log | DONE-MERGED (PR #2) | — | CRITICAL | Onaylı plan |
| INF-04 | En az yetkili PostgreSQL rolü (`tm_app`) | DONE-MERGED (PR #2) | — | CRITICAL | Onaylı plan |
| INF-05 | HTTP katmanı sertleştirme (helmet, CORS, body limit) | DONE-MERGED (PR #3) | — | STANDARD | Onaylı plan |
| INF-06 | Redis tabanlı auth rate limiting (fail-closed) | DONE-MERGED (PR #3) | — | STANDARD | Onaylı plan |
| INF-07 | Next.js BFF: Redis oturumu, CSRF, açık proxy koruması, güvenlik başlıkları | DONE-MERGED (PR #4) | — | CRITICAL | Onaylı plan |
| INF-08 | Yetkisiz erişim / oturum süresi e2e testleri, PR otomasyon kuralları | DONE-MERGED (PR #5) | — | FAST | Onaylı plan |
| INF-09 | Kuyruk altyapısı (BullMQ/Redis): tenant context taşıyan job, retry/backoff, ölü kuyruk, idempotency anahtarı | DONE-MERGED (PR #14, merge `6fef239`; dev `f010233`, 2026-10-30) | 3 | CRITICAL | Öneri (onay bekliyor) |
| INF-10 | CI pipeline (GitHub Actions): lint, typecheck, unit, e2e (servis konteynerli PG/Redis), frontend test; PR'da zorunlu kontrol | DONE-MERGED (PR #11, merge `9c405bd`; dev `f010233`, 2026-10-30) | 2 | STANDARD | Öneri (onay bekliyor) |
| INF-12 | Nesne depolama (S3 uyumlu; dev'de MinIO): tenant önekli anahtar, imzalı URL | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| INF-18 | Mağaza değiştirmede Redis hatası: sahte "token hırsızlığı" audit'i ve tüm cihazlardan çıkışın önlenmesi | DONE-MERGED (PR #10, merge `113b522`; dev `f010233`, 2026-10-30) | 2 | CRITICAL | Öneri (onay bekliyor) |
| USR-01 | Tenant-scoped firma (company) API | DONE-MERGED (PR #3) | — | CRITICAL | Onaylı plan |
| USR-02 | Firma ekranları (liste, detay, oluştur, düzenle) | DONE-MERGED (PR #4) | — | STANDARD | Onaylı plan |
| USR-T1 | Aşama 1 migration SQL'i, ön kontroller, doğrulama sorguları (`20261029090000_tenant_memberships`) | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-T2 | Yedek ve izole prova betiği (`backup-and-rehearse.sh`), Aşama 2 SQL hazırlığı (`migrations-pending/`) | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-T3 | ⛔ Onay kapısı — dev DB'de Aşama 1 | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-T4 | Global kullanıcı modeli + üyelikle login/register | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-T5 | Mağaza değiştirme ve üyelik listesi (backend + BFF + seçici) | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-T6 | `auth_version` ile anında oturum geçersizleştirme | DONE-MERGED (PR #6; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | Onaylı plan |
| USR-17 | Güvenlik düzeltmesi: pasif / soft-delete kullanıcıya login ve refresh'te token verilmemesi, yanlış şifre audit'i arka planda | DONE-MERGED (PR #6, `140d348`, `946dec0`; merge `f1be19a`; dev `f010233`, 2026-10-30) | — | CRITICAL | PR #6 güvenlik düzeltmesi (uygulandı) |
| USR-T7 | Rol kataloğu, erişim servisi ve kurallar (`ROLE_CATALOG`, `AccessService`, `canGrant`, son owner koruması) | DONE-MERGED (PR #8, merge `cc8b72a`; dev `f010233`, 2026-10-30) | 2 | CRITICAL | Onaylı plan |
| USR-T8 | Companies modülünü firma başına role bağla; `auth/me` yetenek bayrakları | DONE-MERGED (PR #9, merge `95b5bdb`; dev `f010233`, 2026-10-30) | 2 | CRITICAL | Onaylı plan |
| USR-T9a | Mail modülü çekirdeği: `MailService.send`, SMTP/log transport, `mail.config` (prod'da `log` yasak, TLS zorunlu), Mailpit (docker), URL/token loglanmaz | DONE-MERGED (PR #12, merge `f9b5889`; dev `f010233`, 2026-10-30) | 1,5 | STANDARD | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T10a | Davet servisi çekirdeği: oluştur (Admin / firma rolleri), iptal, yeniden gönder (yeni token), lookup, kabul (yeni hesap; mevcut hesap şifreyle) | DONE-MERGED (PR #15, merge `bc37227`; dev `f010233`, 2026-10-30) | 3 | CRITICAL | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T11a | Users modülü çekirdeği: `GET /users`, `PUT /users/:userId/access`, `POST /users/:userId/deactivate` / `activate` (T6 `bumpAuthVersion` + refresh iptali), audit | DONE-MERGED (PR #19, merge `8fc7ae3`; dev `8fc7ae3`, 2026-10-30) | 2,5 | CRITICAL | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T12a | BFF route'ları çekirdeği: users + invitations (oluştur, iptal) allowlist, `PUT`, oturumsuz `invitations/lookup` ve `accept`, `/invite/*` için `Referrer-Policy: no-referrer` | PLANNED | 0,5 | CRITICAL | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T13a | Kullanıcılar sayfası (masaüstü tablo), davet diyaloğu + erişim düzenleyici, pasife al/aktifleştir; davet kabul sayfası (`loading`, `invalid`, `newAccount`, `existingAccount`, `done`) | PLANNED | 2 | STANDARD | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T14 | Yetki yükseltme ve tenant izolasyonu test paketi | PLANNED | 2 | CRITICAL | Onaylı plan |
| USR-T15a | Playwright çekirdek akışlar: owner muhasebeciyi A firmasına davet eder, davetli yalnızca A'yı görür; iptal edilen bağlantı geçersiz sayfası; pasife alınan kullanıcı sonraki işlemde çıkış yapar | PLANNED | 1 | STANDARD | Onaylı plan — MVP dilimi (bölme: öneri, onay bekliyor) |
| USR-T16 | Tam doğrulama ve PR | PLANNED | 1 | STANDARD | Onaylı plan |
| USR-19 | Şifre sıfırlama ve e-posta doğrulama (hash'li tek kullanımlık token) | PLANNED | 3 | CRITICAL | Öneri (onay bekliyor) |
| DSH-01 | Uygulama kabuğu ve dashboard iskeleti | DONE-MERGED (PR #4) | — | FAST | Onaylı plan |
| CAT-01 | Katalog şeması: kategori, marka, ürün, varyant, barkod/SKU (tenant + firma kapsamlı) | DONE-MERGED (PR #13, merge `aa02144`; dev `f010233`, 2026-10-30) | 3 | CRITICAL | Öneri (onay bekliyor) |
| CAT-02 | Ürün CRUD API (liste, filtre, sayfalama, soft-delete, audit) | DONE-MERGED (PR #16, merge `6824f6f`; dev `f010233`, 2026-10-30) | 3 | STANDARD | Öneri (onay bekliyor) |
| CAT-03 | Varyant ve özellik (attribute) yönetimi | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| CAT-04 | Katalog UI: liste, filtre, ürün formu, varyant editörü | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| CAT-05 | Fiyat yönetimi: liste fiyatı, kanal fiyatı, KDV oranı (`decimal` + para birimi) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| CAT-06 | Kanal kategori ağacı ve zorunlu özellik eşleme modeli + UI | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| IMP-01 | Excel/CSV şablonu, satır doğrulama, deneme (dry-run) raporu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| IMG-01 | Görsel yükleme, sıralama, ürün/varyanta bağlama | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-01 | `ChannelAdapter` arayüzü, kanal hesabı modeli, kimlik bilgisi şifreleme (envelope encryption, anahtar rotasyonu) | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| INT-02 | Senkron motoru: kanal başına rate limiter, retry, idempotency, senkron logu, çakışma çözümü | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| INT-03 | Entegrasyon yönetim UI: bağla, test et, durum, hata logu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-TY-01 | Trendyol bağlantısı + ürün oluşturma/güncelleme, batch durum takibi | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-TY-02 | Trendyol stok ve fiyat senkronu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-TY-03 | Trendyol sipariş çekme, paket durumu, kargo bilgisi, iptal (tedarik edememe) ve iade (claim) senkronu, yerel stok iadesi | PLANNED | 6 | STANDARD | Öneri (onay bekliyor) |
| ORD-01 | Sipariş şeması: sipariş, kalem, durum geçmişi, kanal referansı (tekil `channel + external_id`) | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| ORD-02 | Sipariş API ve durum makinesi (geçersiz geçiş reddi, audit) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| ORD-03 | Sipariş UI: liste, filtre, detay, toplu işlem (etiket yazdır, durum) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INV-01 | Depo ve stok şeması; append-only stok hareketleri | PLANNED | 3 | CRITICAL | Öneri (onay bekliyor) |
| INV-02 | Rezervasyon ve sipariş bağlı düşüm (eşzamanlılık güvenli) | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| INV-03 | Stok UI, düşük stok eşiği ve uyarısı | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| SHP-02 | Pazaryeri kargo entegrasyonu üzerinden etiket ve takip numarası | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| RPT-01 | Satış raporları (dönem, kanal, ürün) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| OPS-01 | Yapılandırılmış log + hata izleme (ör. Sentry), istek kimliği | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| OPS-03 | Otomatik yedekleme ve geri yükleme (PITR), geri yükleme tatbikatı | PLANNED | 3 | CRITICAL | Öneri (onay bekliyor) |
| OPS-08 | `backup-and-rehearse.sh` genelleştirme (son migration'dan başlangıç, `verify.sql`, `down.sql` provası) | PLANNED | 1 | STANDARD | Kullanıcı kararı (2026-10-30) |

### Sürüm B — Ticari SaaS (62 görev: 0 tamamlandı + 62 kalan; kalan tahmin 190 iş günü; 23 EPIC)

| ID | Görev | Durum | Tahmin | Mod | Kaynak |
|---|---|---|---|---|---|
| INF-11 | Staging ortamı ve deploy pipeline (migration `migrate deploy` adımı, onay kapısı, geri dönüş) | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| INF-13 | Secret yönetimi ve yapılandırma doğrulaması (prod'da secret manager) | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| INF-14 | Redis yüksek erişilebilirlik (replika + failover) ve alarm | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INF-15 | CAPTCHA (kayıt + tekrarlı başarısız login) ve sızmış şifre kontrolü (HIBP k-anonymity) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| INF-16 | Nonce tabanlı CSP (`unsafe-inline` kaldırılır) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| INF-17 | Prod ağ/TLS yapılandırması: `TRUST_PROXY`, `BFF_TRUST_PROXY`, backend yalnız iç ağ, HTTPS | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| INF-19 | BFF `forceRefresh` yarışı (`stillNeeded`) nedeniyle oturum kapanması | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| INF-20 | Kayıtta `409` ile hesap varlığının sızması (kullanıcı numaralandırma) | PLANNED | 1 | CRITICAL | Öneri (onay bekliyor) |
| USR-T9 | Mail modülü ve Mailpit | PLANNED | 0,5 | STANDARD | Onaylı plan |
| USR-T10 | Davet servisi (oluştur, yeniden gönder, iptal, lookup, kabul) | PLANNED | 1 | CRITICAL | Onaylı plan |
| USR-T11 | Users modülü (liste, erişim düzenleme, pasife alma) | PLANNED | 0,5 | CRITICAL | Onaylı plan |
| USR-T12 | BFF route'ları (kullanıcı/davet allowlist, oturumsuz davet route'ları) | PLANNED | 0,5 | CRITICAL | Onaylı plan |
| USR-T13 | Kullanıcılar sayfası, davet diyaloğu, davet kabul sayfası | PLANNED | 1 | STANDARD | Onaylı plan |
| USR-T15 | Playwright akışları (davet, erişim, mağaza değiştirme, mobil) | PLANNED | 1 | STANDARD | Onaylı plan |
| USR-18 | Aşama 2 migration: `users.tenant_id` / `users.is_active` eski kolonlarını kaldırma; önce guard ve login/refresh'in `users.is_active` okuması yeni modele taşınır | BLOCKED (T16 + ayrı migration onayı) | 3 | CRITICAL | Öneri (onay bekliyor) |
| USR-20 | İki adımlı doğrulama (TOTP) ve kurtarma kodları | PLANNED | 3 | CRITICAL | Öneri (onay bekliyor) |
| USR-21 | Sahiplik devri (owner rolünü devretme) | PLANNED | 1,5 | CRITICAL | Kullanıcı kararı (2026-10-30) |
| DSH-02 | KPI kartları: günlük sipariş, ciro, bekleyen kargo, düşük stok, entegrasyon hataları | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| DSH-03 | Bildirim merkezi (uygulama içi + e-posta tercihleri) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| IMP-02 | Asenkron içe aktarma işi (kuyruk), ilerleme ve hata raporu indirme | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| IMP-03 | URL'den ürün içe aktarma (sayfa/feed çekme) | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| IMP-04 | Toplu dışa aktarma (ürün, stok, fiyat) | PLANNED | 2 | FAST | Öneri (onay bekliyor) |
| IMG-02 | Yeniden boyutlandırma/türev üretimi ve pazaryeri görsel kurallarına uygunluk kontrolü | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| INT-04 | Webhook alıcısı (imza doğrulama, tekrar oynatma koruması) | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| INT-HB-01 | Hepsiburada bağlantısı + listeleme/katalog eşleme | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-HB-02 | Hepsiburada stok ve fiyat senkronu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-HB-03 | Hepsiburada sipariş, paketleme, kargo, iptal/iade | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-AMZ-01 | Amazon SP-API bağlantısı (LWA OAuth, uygulama kaydı) + listeleme (Listings/Feeds) | PLANNED | 6 | CRITICAL | Öneri (onay bekliyor) |
| INT-AMZ-02 | Amazon stok ve fiyat senkronu | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| INT-AMZ-03 | Amazon sipariş (PII için kısıtlı veri erişimi), kargo onayı, iade | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| INT-N11-01 | n11 bağlantısı + ürün/listeleme | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-N11-02 | n11 stok ve fiyat senkronu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-N11-03 | n11 sipariş, kargo, iptal/iade | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| ORD-04 | Manuel / telefonla sipariş girişi | PLANNED | 2 | FAST | Öneri (onay bekliyor) |
| INV-04 | Çoklu depo transferi ve stok sayımı | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| SHP-01 | İptal ve iade akışı: talep, onay/ret, stok iadesi, kanal bildirimi | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| SHP-03 | Anlaşmalı kargo firmaları API'leri (ör. Yurtiçi, Aras, MNG) | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| EFT-01 | Özel entegratör adapter soyutlaması + ilk entegratör (sözleşme ve test hesabı gerekir) | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| EFT-02 | Siparişten e-Arşiv / e-Fatura kesimi (mükellef sorgusu, seri/numara, KDV) | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| EFT-03 | Fatura iptali ve iade faturası | PLANNED | 3 | CRITICAL | Öneri (onay bekliyor) |
| EFT-04 | Faturanın pazaryerine iletilmesi (link/PDF) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| CRM-01 | Müşteri modeli (siparişten türetme, adres), KVKK alan maskeleme | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| CRM-02 | Müşteri UI: liste, detay, sipariş geçmişi | PLANNED | 2 | FAST | Öneri (onay bekliyor) |
| CRM-03 | Tedarikçi ve satın alma siparişi (stok girişine bağlı) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| CMP-01 | Kanal kampanya/indirim yönetimi (planlı fiyat değişimi, geri alma) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| PRF-01 | Maliyet ve gider modeli: ürün maliyeti, komisyon tablosu, kargo, sabit gider dağıtımı | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| PRF-02 | Sipariş ve ürün bazlı kâr hesaplama (iade/iptal etkisi dahil) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| PRF-03 | Kârlılık raporu UI (ürün, kanal, dönem) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| STL-01 | Hakediş/finans verisi çekme (Trendyol, Hepsiburada finans API'leri) | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| STL-02 | Mutabakat motoru: beklenen (sipariş − komisyon − kesinti) vs ödenen | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| STL-03 | Fark raporu ve UI | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| RPT-02 | Stok raporları (değer, devir, stoksuz kalma) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| RPT-03 | Excel/PDF dışa aktarma ve zamanlanmış e-posta raporu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| SUB-01 | Plan/paket ve limit modeli (kanal sayısı, ürün, kullanıcı) | PLANNED | 2 | CRITICAL | Öneri (onay bekliyor) |
| SUB-02 | Ödeme sağlayıcı entegrasyonu (ör. iyzico/PayTR; kart saklama sağlayıcıda, tokenization) | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| SUB-03 | Faturalama döngüsü: deneme süresi, yenileme, başarısız ödeme takibi (dunning), abonelik faturası | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| SUB-04 | Limit uygulama (feature gating) ve plan aşımı uyarısı | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| OPS-02 | Metrikler, uptime ve alarm (DB, Redis, kuyruk, entegrasyon hata oranı) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| OPS-06 | Yük ve performans testi (senkron, sipariş içeri alma, raporlar) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| OPS-04 | Sistem yöneticisi (süper admin) paneli: tenant listesi, askıya alma, süreli ve audit'li destek erişimi | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| OPS-05 | KVKK: veri dışa aktarma/silme talebi, saklama süreleri, aydınlatma metni | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |
| OPS-07 | Bağımsız güvenlik denetimi / sızma testi ve bulguların kapatılması | PLANNED | 4 | CRITICAL | Öneri (onay bekliyor) |

### Sürüm C — Gelişmiş SaaS (21 görev: 0 tamamlandı + 21 kalan; kalan tahmin 87 iş günü; 9 EPIC)

| ID | Görev | Durum | Tahmin | Mod | Kaynak |
|---|---|---|---|---|---|
| AIU-01 | Başlık/açıklama/anahtar kelime önerisi (pazaryeri kurallarına göre), onaylı uygulama | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| AIU-02 | Görselden özellik çıkarma (renk, materyal, kategori önerisi) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| AIU-03 | Toplu AI zenginleştirme (içe aktarılan ürünler için kuyrukta) | PLANNED | 2 | STANDARD | Öneri (onay bekliyor) |
| IMG-03 | AI arka plan temizleme / beyaz fon | PLANNED | 2 | FAST | Öneri (onay bekliyor) |
| INT-PZR-01 | Pazarama bağlantısı + ürün/listeleme | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-PZR-02 | Pazarama stok ve fiyat senkronu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-PZR-03 | Pazarama sipariş, kargo, iptal/iade | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-CS-01 | ÇiçekSepeti bağlantısı + ürün/listeleme | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-CS-02 | ÇiçekSepeti stok ve fiyat senkronu | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| INT-CS-03 | ÇiçekSepeti sipariş, kargo, iptal/iade | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| INT-TEMU-01 | Temu satıcı API bağlantısı + ürün/listeleme (TR satıcı API erişimi doğrulanmalı) | PLANNED | 6 | STANDARD | Öneri (onay bekliyor) |
| INT-TEMU-02 | Temu stok ve fiyat senkronu | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| INT-TEMU-03 | Temu sipariş, kargo, iptal/iade | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| EFT-05 | Muhasebe dışa aktarımı (ör. Logo, Mikro, Paraşüt formatları) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| CMP-02 | Reklam harcaması içe aktarma (kanal reklam API'leri / dosya) | PLANNED | 3 | STANDARD | Öneri (onay bekliyor) |
| CMP-03 | AI kampanya optimizasyon önerisi (bütçe, indirim oranı) | PLANNED | 4 | STANDARD | Öneri (onay bekliyor) |
| RPT-04 | Gelişmiş analitik (kanal karşılaştırma, kohort, trend) | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| AIE-01 | `ai-engine` çekirdeği: LLM sağlayıcı soyutlaması, tenant kotası/maliyet takibi, prompt injection ve veri sızıntısı koruması | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| AIE-02 | AI asistan (sohbet): salt-okunur, kullanıcının yetkisiyle sınırlı sorular | PLANNED | 5 | CRITICAL | Öneri (onay bekliyor) |
| AIE-03 | Kural tabanlı otomasyonlar (fiyat/stok kuralları; öneri → onay → uygula) | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |
| AIE-04 | Satış tahmini ve stok yenileme önerisi | PLANNED | 5 | STANDARD | Öneri (onay bekliyor) |

---

## Özet sayılar

| Ölçü | Değer |
|---|---|
| Modül | 20 |
| EPIC | 33 |
| Görev | 141 (133 + 6 MVP dilimi: USR-T9a, T10a, T11a, T12a, T13a, T15a + 2 kullanıcı kararı 2026-10-30: OPS-08, USR-21) |
| DONE-MERGED | 28 |
| DONE-PR | 0 |
| DONE-NOT-DEPLOYED | 0 |
| IN-PROGRESS | 0 |
| BLOCKED | 1 (USR-18) |
| PLANNED | 112 |
| Sürüm A | 58 görev (28 tamamlandı + 30 kalan), 18 EPIC, kalan 87,5 iş günü |
| Sürüm B | 62 görev (0 tamamlandı + 62 kalan), 23 EPIC, kalan 190 iş günü |
| Sürüm C | 21 görev (0 tamamlandı + 21 kalan), 9 EPIC, kalan 87 iş günü |
| Mod: CRITICAL / STANDARD / FAST | 55 / 79 / 7 |
| Kaynak: Onaylı plan / Onaylı plan MVP dilimi / PR #6 düzeltmesi / Kullanıcı kararı / Öneri | 27 / 6 / 1 / 2 / 105 |
