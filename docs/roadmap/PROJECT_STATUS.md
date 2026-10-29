# Proje Durumu

Son güncelleme: 2026-10-29 (MVP Trendyol-only olarak sadeleştirildi) · Kaynak: `feature/user-management` @ `946dec0` · Güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".

## 1. Özet

| Ölçü | Değer |
|---|---|
| Toplam EPIC / görev | 33 / 139 (133 + 6 kullanıcı yönetimi MVP dilimi) |
| Tamamlanan | 18 (%12,9) — 11 `DONE-MERGED`, 7 `DONE-PR` (PR #6, merge yok, deploy yok) |
| BLOCKED | 2 — USR-T7 (kullanıcı onayı), USR-18 (T16 + Aşama 2 migration onayı) |
| Sürüm A (Trendyol-only MVP) ilerleme | 18 / 57 görev; kalan 39 görev, 110,5 iş günü; tahmini hedef 2027-02-12 (taahhüt değil) |
| Sürüm B / C | 61 / 21 görev |
| Açık PR | #6 `feature/user-management` → `main` — **M1 düzeltmesi sürüyor, tamamlanmadı**; merge edilmedi · #7 `docs/master-roadmap` (draft, yalnızca doküman) |
| `origin/main` | `78e5f8d` (PR #5 merge) |
| Dev ortamı | **Dev backend şu an çalışmıyor** (2026-10-29: `:3000` ve `:4000` portları boş). Son deploy edilen kod `eda38da` (Task 4) |
| Dev DB şeması | Aşama 1 migration `20261029090000_tenant_memberships` uygulanmış (kullanıcı onayıyla) |
| Son testler (PR #6 head) | backend unit 184/184, backend e2e 165/165, frontend 81/81 |

### Modül bazında tamamlanma (görev sayısına göre)

| Modül | Tamamlanan / Toplam | % | Not |
|---|---|---|---|
| M01 INF | 8 / 20 | 40 | Hepsi merge edildi |
| M02 USR | 9 / 28 | 32 | 2 merge edildi (%9); 7'si PR #6'da |
| M03 DSH | 1 / 3 | 33 | İskelet |
| M04–M20 | 0 / 88 | 0 | Başlanmadı |
| **Toplam** | **18 / 139** | **12,9** | Merge edilmiş: 11 / 139 (%7,9) |

## 2. PR #6 — içerik ve durum

**Bağlantı:** https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/6 · Dal `feature/user-management` · Hedef `main` · 57 dosya.

**Durum: MERGE EDİLMEDİ. DEV'E DEPLOY EDİLMEDİ. M1 düzeltmesi PR #6'da sürüyor (tamamlanmadı).** Merge yalnızca kullanıcının sohbetteki açık onayıyla yapılır.

| Görev | Commit(ler) | İçerik |
|---|---|---|
| USR-T1 | `2d60837`, `f438a43` | Aşama 1 migration: `tenant_memberships`, `invitations`, rol `key/scope/is_system`, nullable `users.tenant_id`, composite FK'ler, doğrulama ve rollback SQL'i |
| USR-T2 | `45789d2`, `5939dea` | `database/scripts/backup-and-rehearse.sh`, Aşama 2 SQL'i `migrations-pending/` altında (uygulanmadı) |
| USR-T3 | — | Onay kapısı: yalnızca rapor. Dev DB migration'ı sonradan kullanıcı onayıyla uygulandı |
| USR-T4 | `28cc5ec`, `eda38da` | Global kullanıcı, üyelikle login/register, `User` modeli tenant context'te yasak |
| USR-T5 | `476c00e`, `5821afa`, `bf024db` | Mağaza değiştirme, üyelik listesi, BFF `/api/session/tenant`, seçici |
| USR-T6 | `9eb83ac`, `08bbc24` | Üyelik `auth_version` ile anında oturum iptali; pasif kullanıcının oturumları iptal |
| USR-17 | `140d348`, `946dec0` | Pasif / soft-delete kullanıcıya login ve refresh'te token verilmez; yanlış şifre audit'i arka planda |

Dev'de olmayanlar: `eda38da` sonrası tüm commit'ler (T5, T6, USR-17). Bu commit'ler yeni migration içermez (`git diff eda38da..946dec0 -- database/` boş), bu nedenle dev DB şeması PR #6 ile uyumludur.

## 3. PR #6 merge ve dev deploy önkoşulları

### Merge önkoşulları

1. Tüm PR diff'inin bağımsız incelemesi (CRITICAL mod); açık bulgu yok.
2. PR head'inde tam doğrulama, sonuçlar PR açıklamasında: backend `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build`; frontend `npm test`, `npm run lint`, `npm run typecheck`; ayrı kopyada `next build` (çalışan dev sunucusunun üzerinde değil); Playwright.
3. `gh pr view 6` → mergeable, CI (kurulduysa) yeşil; `main` ile çakışma yok.
4. Diff'te `.env`, dump, secret yok.
5. PR açıklamasında kalan riskler yazılı: INF-18, INF-19, INF-20, `users.is_active` bağımlılığı, Aşama 2'nin uygulanmadığı.
6. **Kullanıcının sohbette açık merge onayı.**

### Dev deploy önkoşulları

1. Merge tamamlandı (veya kullanıcı açıkça dal deploy'una onay verdi).
2. Dev DB yedeği: `bash database/scripts/backup-and-rehearse.sh <out-dir>` → çıkış 0.
3. `cd backend && npx prisma migrate status` → bekleyen migration yok (Aşama 1 zaten uygulanmış; PR #6 yeni migration getirmez). Aşama 2 **uygulanmaz**.
4. Backend'in (`:4000`) yeni kodla başlatılması için kullanıcı onayı (2026-10-29 itibarıyla dev backend çalışmıyor).
5. Smoke test: login, `auth/memberships`, mağaza değiştirme, pasife alınan üyenin sonraki isteğinin `SESSION_REVOKED` alması, pasif kullanıcının login/refresh'inin reddi.
6. Geri dönüş planı: `eda38da` kodunu yeniden başlat (DB şeması uyumlu); gerekirse 2. adımdaki yedekten geri yükleme.
7. Deploy sonrası bu dosya ve `TASK_REGISTER.md` güncellenir (`AGENTS.md` kuralları).

## 4. Sıradaki 10 görev (önerilen sıra, 2 akış)

| # | ID | Başlık | Not |
|---|---|---|---|
| 0 | — | PR #6 M1 düzeltmesini bitir, incele, kullanıcı onayıyla merge + dev deploy (M0) | Sürüyor; dev backend şu an çalışmıyor |
| 1 | USR-T7 | Rol kataloğu, erişim servisi ve kurallar | Akış 2; M0 + kullanıcı onayı sonrası ("Task 7'ye başlama" geçerli) |
| 2 | CAT-01 | Katalog şeması | Akış 1; USR-T7/T8 ile paralel; migration onayı gerekir (G3) |
| 3 | USR-T8 | Companies modülünü firma başına role bağla | Kritik yol |
| 4 | CAT-02 | Ürün CRUD API | Merge öncesi USR-T8 izin kontrolü |
| 5 | INF-18 | Mağaza değiştirmede Redis hatası düzeltmesi | Prod öncesi zorunlu |
| 6 | INF-10 | CI pipeline | Sonraki tüm PR'ları hızlandırır |
| 7 | CAT-03 | Varyant ve özellik yönetimi | CAT-06 ile paralel |
| 8 | USR-T9a | Mail modülü çekirdeği | USR-19 ve USR-T10a'nın önkoşulu |
| 9 | USR-T10a | Davet servisi çekirdeği | İlk müşterinin ekip eklemesi için |
| 10 | INF-09 | Kuyruk altyapısı | INT-02'nin önkoşulu |

**Dış iş (kullanıcı, hemen):** Trendyol satıcı hesabı, API anahtarı ve stage erişimi / IP whitelist başvurusu — MVP'nin ana dış kapısı, en geç ≈ 2026-12-28.

## 5. Riskler

Ciddiyet: **Kritik** (veri kaybı, tenant sızıntısı, ödeme) · **Yüksek** (güvenlik açığı veya geniş kesinti) · **Orta** (sınırlı etki) · **Düşük**.

### 5.1 Risk listesi

| ID | Ciddiyet | Risk | Bugünkü durum | Çözüm görevi |
|---|---|---|---|---|
| R-01 | Kritik | Aşama 2 migration'ı (`users.is_active`, `users.tenant_id` kaldırma) guard ve login/refresh hâlâ `users.is_active` okurken çalıştırılırsa tüm girişler bozulur veya pasif kullanıcı kontrolü kaybolur (`backend/src/auth/user-state.ts`, `auth.repository.ts`) | Aşama 2 uygulanmadı, `migrations-pending/`'de | USR-18 (önce kod, sonra migration, onay) |
| R-02 | Kritik | Prod öncesi otomatik yedek, PITR ve geri yükleme tatbikatı yok; şu an yalnızca elle çalışan betik var | Açık | OPS-03 |
| R-03 | Yüksek | Firma rolü yetki sınırları henüz uygulanmıyor: `user_company_roles` var ama companies modülü firma bazlı izin kontrol etmiyor; davet/kullanıcı yönetimi gelince yetki yükseltme yüzeyi açılır | Bugün yalnızca owner rolü atanabildiği için istismar yolu sınırlı | USR-T7, USR-T8, USR-T14 |
| R-04 | Yüksek | Mağaza değiştirme sırasında Redis çökerse refresh zinciri yeniden kullanım (token hırsızlığı) olarak algılanabilir → sahte audit kaydı ve kullanıcının tüm cihazlardan çıkışı | Açık | INF-18 |
| R-05 | Yüksek | Redis tek nokta: rate limiting ve BFF oturumu fail-closed; Redis kesintisinde kimse giriş yapamaz | Dev'de tek Redis | INF-14 |
| R-06 | Yüksek | Tenant izolasyonu yeni modüllerde ihlal edilebilir (her yeni tablo/sorgu, kuyruk job'ları, ai-engine istekleri) | Prisma eklentisi + izin listesi testi var; job'lar için yok | INF-09, her modülde S testleri, USR-T14 |
| R-07 | Yüksek | Prod ağ/TLS/proxy yapılandırması yanlışsa IP rate limit herkesi birlikte engeller veya backend internete açılır | Prod yok | INF-17 |
| R-08 | Orta | BFF `forceRefresh` `stillNeeded` yarışı: eşzamanlı isteklerde oturum kapanabilir (kabul edilmiş, düzeltilmedi; MVP'den B'ye ertelendi, pilotta kabul edilmiş risk) | Açık | INF-19 |
| R-09 | Orta | Kayıtta `409` yanıtı e-postanın kayıtlı olduğunu sızdırır (kullanıcı numaralandırma) | Açık | INF-20 |
| R-10 | Orta | CSP `script-src 'unsafe-inline'` | Açık | INF-16 |
| R-11 | Orta | CI yok; testler yalnızca yerelde koşuyor, kırık kod merge edilebilir | Açık | INF-10 |
| R-12 | Orta | Dev ortamı PR #6'nın gerisinde (`eda38da`) ve dev backend şu an çalışmıyor; dev'de elle test yapılamaz, yapılsa T5/T6 davranışını yansıtmaz | Açık | §3 dev deploy |
| R-13 | Orta | CAPTCHA ve sızmış şifre kontrolü yok | Açık | INF-15 |
| R-14 | Düşük | `origin/HEAD` `feature/backend-setup`'a işaret ediyor, PR'lar `main`'e gidiyor; yerel `main` dalı `origin/main`'in gerisinde — yanlış hedef dal riski | Açık | Depo ayarı: varsayılan dalı `main` yap (kullanıcı) |
| R-15 | Kritik (gelecek) | Pazaryeri / entegratör / ödeme kimlik bilgilerinin sızması | Henüz kod yok | INT-01, EFT-01, SUB-02 |
| R-16 | Kritik (gelecek) | Ödeme: çift tahsilat, kart verisinin sisteme girmesi | Henüz kod yok | SUB-02, SUB-03 |
| R-17 | Yüksek (gelecek) | KVKK: pazaryeri müşteri kişisel verileri (ad, adres, telefon) | Henüz kod yok | CRM-01, INT-AMZ-03, OPS-05 |
| R-18 | Yüksek (gelecek) | URL içe aktarmada SSRF | Henüz kod yok | IMP-03 |
| R-19 | Yüksek (gelecek) | ai-engine: prompt injection, tenant arası veri sızıntısı, kontrolsüz maliyet | Henüz kod yok | AIE-01, AIE-02 |
| R-20 | Orta (takvim) | Dış API/sandbox erişimi ve entegratör sözleşmelerinin gecikmesi | Bekleniyor | Kullanıcı (bkz. `RELEASE_PLAN.md`) |
| R-21 | Orta (takvim) | Tek insan onaylayıcı darboğazı (merge, migration, deploy kapıları) | Yapısal | Toplu onay pencereleri |
| R-23 | Yüksek (takvim) | Trendyol API / stage erişimi gelmezse INT-TY-01…03 ve SHP-02 `BLOCKED`, MVP hedefi kayar. Stage taban URL'i ve başvuru süreci doğrulanmadı; IP whitelist yalnızca IPv4, en fazla 7 IP, süreli | Bekleniyor | Kullanıcı başvurusu (M1'den önce) |
| R-22 | Orta | Prod öncesi performans/yük testi ve izleme/alarm yok | Açık | OPS-01, OPS-02, OPS-06 |

### 5.2 Canlıya (production) çıkmadan önce mutlaka düzeltilecekler

1. R-01 — USR-18: `users.is_active` okumaları kaldırılmadan Aşama 2 çalıştırılmaz.
2. R-02 — OPS-03: otomatik yedek + geri yükleme tatbikatı.
3. R-03 — USR-T7, USR-T8, USR-T14: firma rolü sınırları ve yetki yükseltme paketi.
4. R-04 — INF-18: Redis hatasında sahte hırsızlık/çıkış.
5. R-05 — INF-14: Redis HA ve alarm.
6. R-06 — her modülde tenant izolasyon testleri; job'larda tenant context zorunluluğu.
7. R-07 — INF-17: TLS, proxy, backend iç ağ.
8. R-08 — INF-19: `forceRefresh` yarışı.
9. R-09 — INF-20: kayıt numaralandırması.
10. R-10, R-13 — INF-16, INF-15: nonce CSP, CAPTCHA, sızmış şifre.
11. R-11 — INF-10: CI zorunlu kontrol.
12. R-15, R-16, R-17 — ilgili modüller canlıya bu korumalarla çıkar.
13. R-22 — OPS-01, OPS-02, OPS-06: izleme, alarm, yük testi.
14. `SECURITY.md` §4 kontrol listesinin tamamı; OPS-07 bağımsız güvenlik denetimi.

## 6. Durum geçmişi

| Tarih | Değişiklik | PR | Test | Deploy |
|---|---|---|---|---|
| 2026-10-28 | INF-01…08, USR-01, USR-02, DSH-01 → DONE-MERGED | #1–#5 | — | dev |
| 2026-10-29 | USR-T1…T6, USR-17 → DONE-PR | #6 | unit 184/184, e2e 165/165, fe 81/81 | yok (dev `eda38da`) |
| 2026-10-29 | Yol haritası oluşturuldu | — | — | — |
| 2026-10-29 | MVP Trendyol-only olarak sadeleştirildi (kullanıcı kararı): 18 görev B'ye, USR-T9…T15'ten 6 MVP dilimi, INT-TY-03'e yerel stok iadesi | #7 | — | — |
