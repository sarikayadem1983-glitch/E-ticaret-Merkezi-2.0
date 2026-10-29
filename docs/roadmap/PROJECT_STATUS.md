# Proje Durumu

Son güncelleme: 2026-10-29 (PR #6, #8, #9 merge edildi) · Kaynak: `origin/main` @ `95b5bdb` · Güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".

## 1. Özet

| Ölçü | Değer |
|---|---|
| Toplam EPIC / görev | 33 / 139 (133 + 6 kullanıcı yönetimi MVP dilimi) |
| Tamamlanan | 20 (%14,4) — 11 `DONE-MERGED` (dev'de), 9 `DONE-NOT-DEPLOYED` (USR-T1…T8, USR-17; `main`'de, dev'e deploy edilmedi) |
| BLOCKED | 1 — USR-18 (T16 + Aşama 2 migration onayı) |
| Sürüm A (Trendyol-only MVP) ilerleme | 20 / 57 görev; kalan 37 görev, 106,5 iş günü; tahmini hedef 2027-02-03 (taahhüt değil) |
| Sürüm B / C | 61 / 21 görev |
| Açık PR | #7 `docs/master-roadmap` (draft, doküman) · #11 INF-10 CI → `main` (`1016837`, CI ✓) · #10 INF-18 → `chore/inf-10-ci` (`740be6c`, CI ✓, güvenlik incelemesi temiz, deterministik yarış testi) · CAT-01, USR-T9a/T10a, INF-09 geliştiriliyor — hiçbiri merge edilmedi; önerilen merge sırası #11 → #10 |
| `origin/main` | `95b5bdb` (PR #9 merge; #6 `f1be19a`, #8 `cc8b72a`) |
| Dev ortamı | Son deploy edilen kod `eda38da` (Task 4). `main` dev'e deploy edilmedi (kullanıcı onayı gerekir) |
| Dev DB şeması | Aşama 1 migration `20261029090000_tenant_memberships` uygulanmış (kullanıcı onayıyla); PR #6/#8/#9 yeni migration getirmez |
| Son testler (`main` @ `95b5bdb`, izole PG/Redis) | backend unit 211/211, e2e 173/173, build ok; frontend 81/81, lint ok, typecheck ok, `next build` ok; Playwright 13/13 yalnızca `next dev` ile — `next start` (prod modu, http) 11/13: `APP_ORIGIN` https koruması, bkz. R-24 |

### Modül bazında tamamlanma (görev sayısına göre)

| Modül | Tamamlanan / Toplam | % | Not |
|---|---|---|---|
| M01 INF | 8 / 20 | 40 | Hepsi merge edildi ve dev'de |
| M02 USR | 11 / 28 | 39 | 2'si dev'de; 9'u `main`'de, deploy edilmedi |
| M03 DSH | 1 / 3 | 33 | İskelet |
| M04–M20 | 0 / 88 | 0 | Başlanmadı |
| **Toplam** | **20 / 139** | **14,4** | Dev'e deploy edilmiş: 11 / 139 (%7,9) |

## 2. Merge edilen kullanıcı yönetimi PR'ları

Hepsi merge commit ile, kullanıcının PR başına ayrı onayıyla merge edildi. **Hiçbiri dev'e deploy edilmedi.**

| PR | Merge | Görevler | İçerik |
|---|---|---|---|
| [#6](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/6) | `f1be19a` | USR-T1…T6, USR-17 | Aşama 1 migration, yedek/prova betiği, global kullanıcı + üyelik, mağaza değiştirme, `auth_version` ile oturum iptali, pasif kullanıcıya token verilmemesi, `setup-roles.sql` boş parola koruması |
| [#8](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/8) | `cc8b72a` | USR-T7 | Rol kataloğu, `AccessService`, `canGrant`, son owner koruması |
| [#9](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/9) | `95b5bdb` | USR-T8 | Companies modülünde firma başına rol kontrolü |

Aşama 2 SQL'i (`migrations-pending/`) uygulanmadı (USR-18).

## 3. Dev deploy önkoşulları (`main` @ `95b5bdb`)

1. Dev DB yedeği: `bash database/scripts/backup-and-rehearse.sh <out-dir>` → çıkış 0.
2. `cd backend && npx prisma migrate status` → bekleyen migration yok. Aşama 2 **uygulanmaz**.
3. Backend'in (`:4000`) yeni kodla başlatılması için kullanıcı onayı.
4. Smoke test: login, `auth/memberships`, mağaza değiştirme, pasife alınan üyenin `SESSION_REVOKED` alması, pasif kullanıcının login/refresh reddi, firma rolüne göre erişim (T8).
5. Geri dönüş planı: `eda38da` kodunu yeniden başlat (DB şeması uyumlu); gerekirse 1. adımdaki yedekten geri yükleme.
6. Deploy sonrası USR-T1…T8 ve USR-17 `DONE-MERGED` olur; bu dosya ve `TASK_REGISTER.md` güncellenir.

## 4. Sıradaki görevler (önerilen sıra, 2 akış)

| # | ID | Başlık | Not |
|---|---|---|---|
| 1 | INF-18 | Mağaza değiştirmede Redis hatası | P0; regresyon testiyle kapanışı kanıtlanmalı (sonraki kapıdan önce) |
| 2 | INF-10 | CI pipeline | İzole PG/Redis; sonraki tüm PR'ları korur |
| 3 | CAT-01 | Katalog şeması | Akış 1; migration dev'e uygulanması onay gerektirir (G3) |
| 4 | USR-T9a | Mail modülü çekirdeği | Akış 2; USR-T10a ve USR-19'un önkoşulu |
| 5 | CAT-02 | Ürün CRUD API | USR-T8 artık `main`'de |
| 6 | USR-T10a | Davet servisi çekirdeği | T7 + T9a |
| 7 | INF-09 | Kuyruk altyapısı | INT-02'nin önkoşulu |
| 8 | INT-01 | `ChannelAdapter`, kimlik bilgisi şifreleme | USR-T8 tamam; INF-13 (B) bağımlılığı için bkz. R-25 |
| 9 | CAT-03 | Varyant ve özellik yönetimi | CAT-06 ile paralel |
| 10 | ORD-01 / INV-01 | Sipariş ve stok şemaları | CAT-01 sonrası |

**Dış iş (kullanıcı, hemen):** Trendyol satıcı hesabı, API anahtarı ve stage erişimi / IP whitelist başvurusu — MVP'nin ana dış kapısı, en geç ≈ 2026-12-14 (INT-TY-01 başlangıcı).

## 4a. Dış blokajlar

| ID | Blokaj | Durum (2026-10-29) | Etkilenen görevler | Kim |
|---|---|---|---|---|
| BLK-01 | Trendyol satıcı hesabı, API key/secret, satıcı ID; stage ortamı ve IP whitelist | `apigw.trendyol.com` 401 (erişilebilir, kimlik yok) · `stageapigw.trendyol.com` 403 (IP whitelist yok) · projede Trendyol kimlik bilgisi yok. Sırlar sohbette paylaşılmaz; `.env`'e kullanıcı yazar | INT-TY-01…03, SHP-02, kabul senaryosu | Kullanıcı |

## 5. Riskler

Ciddiyet: **Kritik** (veri kaybı, tenant sızıntısı, ödeme) · **Yüksek** (güvenlik açığı veya geniş kesinti) · **Orta** (sınırlı etki) · **Düşük**.

### 5.1 Risk listesi

| ID | Ciddiyet | Risk | Bugünkü durum | Çözüm görevi |
|---|---|---|---|---|
| R-01 | Kritik | Aşama 2 migration'ı (`users.is_active`, `users.tenant_id` kaldırma) guard ve login/refresh hâlâ `users.is_active` okurken çalıştırılırsa tüm girişler bozulur veya pasif kullanıcı kontrolü kaybolur (`backend/src/auth/user-state.ts`, `auth.repository.ts`) | Aşama 2 uygulanmadı, `migrations-pending/`'de | USR-18 (önce kod, sonra migration, onay) |
| R-02 | Kritik | Prod öncesi otomatik yedek, PITR ve geri yükleme tatbikatı yok; şu an yalnızca elle çalışan betik var | Açık | OPS-03 |
| R-03 | Yüksek | Firma rolü yetki sınırları henüz uygulanmıyor: `user_company_roles` var ama companies modülü firma bazlı izin kontrol etmiyor; davet/kullanıcı yönetimi gelince yetki yükseltme yüzeyi açılır | USR-T7/T8 `main`'de (firma rolü kontrolü var); davet/kullanıcı yönetimi gelince yüzey açılır | USR-T14 |
| R-04 | Yüksek | (PR #10'da düzeltildi, merge bekliyor) Mağaza değiştirme sırasında Redis çökerse refresh zinciri yeniden kullanım (token hırsızlığı) olarak algılanabilir → sahte audit kaydı ve kullanıcının tüm cihazlardan çıkışı | Açık | INF-18 |
| R-05 | Yüksek | Redis tek nokta: rate limiting ve BFF oturumu fail-closed; Redis kesintisinde kimse giriş yapamaz | Dev'de tek Redis | INF-14 |
| R-06 | Yüksek | Tenant izolasyonu yeni modüllerde ihlal edilebilir (her yeni tablo/sorgu, kuyruk job'ları, ai-engine istekleri) | Prisma eklentisi + izin listesi testi var; job'lar için yok | INF-09, her modülde S testleri, USR-T14 |
| R-07 | Yüksek | Prod ağ/TLS/proxy yapılandırması yanlışsa IP rate limit herkesi birlikte engeller veya backend internete açılır | Prod yok | INF-17 |
| R-08 | Orta | BFF `forceRefresh` `stillNeeded` yarışı: eşzamanlı isteklerde oturum kapanabilir (kabul edilmiş, düzeltilmedi; MVP'den B'ye ertelendi, pilotta kabul edilmiş risk) | Açık | INF-19 |
| R-09 | Orta | Kayıtta `409` yanıtı e-postanın kayıtlı olduğunu sızdırır (kullanıcı numaralandırma) | Açık | INF-20 |
| R-10 | Orta | CSP `script-src 'unsafe-inline'` | Açık | INF-16 |
| R-11 | Orta | CI yok; testler yalnızca yerelde koşuyor, kırık kod merge edilebilir | Açık | INF-10 |
| R-12 | Orta | Dev ortamı `main`'in gerisinde (`eda38da`; T5–T8 ve USR-17 dev'de yok) | Açık | §3 dev deploy (onay) |
| R-13 | Orta | CAPTCHA ve sızmış şifre kontrolü yok | Açık | INF-15 |
| R-14 | Düşük | `origin/HEAD` `feature/backend-setup`'a işaret ediyor, PR'lar `main`'e gidiyor; yerel `main` dalı `origin/main`'in gerisinde — yanlış hedef dal riski | Açık | Depo ayarı: varsayılan dalı `main` yap (kullanıcı) |
| R-15 | Kritik (gelecek) | Pazaryeri / entegratör / ödeme kimlik bilgilerinin sızması | Henüz kod yok | INT-01, EFT-01, SUB-02 |
| R-16 | Kritik (gelecek) | Ödeme: çift tahsilat, kart verisinin sisteme girmesi | Henüz kod yok | SUB-02, SUB-03 |
| R-17 | Yüksek (gelecek) | KVKK: pazaryeri müşteri kişisel verileri (ad, adres, telefon) | Henüz kod yok | CRM-01, INT-AMZ-03, OPS-05 |
| R-18 | Yüksek (gelecek) | URL içe aktarmada SSRF | Henüz kod yok | IMP-03 |
| R-19 | Yüksek (gelecek) | ai-engine: prompt injection, tenant arası veri sızıntısı, kontrolsüz maliyet | Henüz kod yok | AIE-01, AIE-02 |
| R-20 | Orta (takvim) | Dış API/sandbox erişimi ve entegratör sözleşmelerinin gecikmesi | Bekleniyor | Kullanıcı (bkz. `RELEASE_PLAN.md`) |
| R-21 | Orta (takvim) | Tek insan onaylayıcı darboğazı (merge, migration, deploy kapıları) | Yapısal | Toplu onay pencereleri |
| R-23 | Yüksek (takvim) | 2026-10-29 kontrolü: `apigw.trendyol.com` 401 (erişilebilir, kimlik yok), `stageapigw.trendyol.com` 403 (IP whitelist yok); projede Trendyol kimlik bilgisi yok. Trendyol API / stage erişimi gelmezse INT-TY-01…03 ve SHP-02 `BLOCKED`, MVP hedefi kayar. Stage taban URL'i ve başvuru süreci doğrulanmadı; IP whitelist yalnızca IPv4, en fazla 7 IP, süreli | Bekleniyor | Kullanıcı başvurusu (M1'den önce) |
| R-22 | Orta | Prod öncesi performans/yük testi ve izleme/alarm yok | Açık | OPS-01, OPS-02, OPS-06 |
| R-24 | Orta | Playwright yalnızca `next dev` ile 13/13; `next start` (prod modu) http'de `APP_ORIGIN` https koruması nedeniyle 11/13. Prod benzeri tarayıcı testi yok | Açık; koruma kapatılmayacak, testler yerel TLS ile koşturulacak | Sürüm A kabul |
| R-25 | Orta (plan) | INT-01 (A) INF-13'e (B, KMS) bağlı; A'da yalnızca yerel anahtarla şifreleme mümkün. Prod öncesi KMS gerekir | Açık | INF-13 (B) |

### 5.2 Canlıya (production) çıkmadan önce mutlaka düzeltilecekler

1. R-01 — USR-18: `users.is_active` okumaları kaldırılmadan Aşama 2 çalıştırılmaz.
2. R-02 — OPS-03: otomatik yedek + geri yükleme tatbikatı.
3. R-03 — USR-T14: yetki yükseltme paketi (USR-T7/T8 `main`'de).
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
| 2026-10-29 | USR-T1…T6, USR-17 → DONE-NOT-DEPLOYED (merge `f1be19a`); USR-T7 → DONE-NOT-DEPLOYED (#8, `cc8b72a`); USR-T8 → DONE-NOT-DEPLOYED (#9, `95b5bdb`) | #6, #8, #9 | `main`: unit 211/211, e2e 173/173, fe 81/81, Playwright 13/13 (`next dev`) | yok (dev `eda38da`) |
