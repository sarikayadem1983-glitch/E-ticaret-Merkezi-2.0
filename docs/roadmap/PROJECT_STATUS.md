# Proje Durumu

Son güncelleme: 2026-10-30 (`main` @ `f010233` dev'e deploy edildi) · Kaynak: `origin/main` @ `f010233` · Güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".

## 1. Özet

| Ölçü | Değer |
|---|---|
| Toplam EPIC / görev | 33 / 139 (133 + 6 kullanıcı yönetimi MVP dilimi) |
| Tamamlanan | 27 (%19,4) — 27 `DONE-MERGED` (hepsi dev'de, `f010233`) |
| BLOCKED | 1 — USR-18 (T16 + Aşama 2 migration onayı) |
| Sürüm A (Trendyol-only MVP) ilerleme | 27 / 57 görev merge edildi ve dev'de; kalan 30 görev, 89 iş günü; tahmini hedef 2027-01-20 (taahhüt değil; önceki 2027-02-03) |
| Sürüm B / C | 61 / 21 görev |
| Açık PR | #20, #21 roadmap (USR-T11a merge/deploy kaydı) · #22 USR-T12a (BFF route'ları; CI ✓, CRITICAL bağımsız inceleme temiz) |
| `origin/main` | `f010233` (PR #17 merge; #7 `23926b1`). `main` CI ✓. Son tam test turu (`6824f6f`, CI): backend unit 283/283, e2e 305/306 (1 skip, Mailpit), frontend 84/84; sonraki commit'ler yalnızca doküman |
| Dev ortamı | `f010233` (2026-10-30, kullanıcı onayıyla). Backend `node dist/main`, frontend `npm run dev`, Mailpit (e-posta dışarı gitmez). Smoke 30/30 |
| Dev DB şeması | Tüm migration'lar uygulandı; son `20261029120000_catalog_schema` (CAT-01, 2026-10-30, kullanıcı onayıyla; öncesinde yedek + izole prova 16/16). `setup-roles.sql` yeniden çalıştırıldı. Aşama 2 (`migrations-pending/`) uygulanmadı |
| Son testler (`main` @ `6824f6f`, CI) | backend unit 283/283, e2e 305/306 (1 skip); frontend 84/84. Önceki yerel tam tur (`95b5bdb`): build ok; frontend 81/81, lint ok, typecheck ok, `next build` ok; Playwright 13/13 yalnızca `next dev` ile — `next start` (prod modu, http) 11/13: `APP_ORIGIN` https koruması, bkz. R-24 |

### Modül bazında tamamlanma (görev sayısına göre)

| Modül | Tamamlanan / Toplam | % | Not |
|---|---|---|---|
| M01 INF | 11 / 20 | 55 | Hepsi dev'de |
| M02 USR | 13 / 28 | 46 | Hepsi dev'de |
| M03 DSH | 1 / 3 | 33 | İskelet |
| M04 CAT | 2 / 6 | 33 | Dev'de; CAT-01 migration'ı uygulandı |
| M05–M20 | 0 / 82 | 0 | Başlanmadı |
| **Toplam** | **27 / 139** | **19,4** | Dev'e deploy edilmiş: 27 / 139 (%19,4) |

## 2. Merge edilen, deploy edilmemiş PR'lar

Yok. #6–#16 2026-10-30'da dev'e deploy edildi (`f010233`) ve bu tablodan çıkarıldı; ayrıntı §6.

Aşama 2 SQL'i (`migrations-pending/`) uygulanmadı (USR-18).

## 3. Dev deploy kaydı (2026-10-30, `main` @ `f010233`)

Kullanıcı onayıyla, yalnızca dev ortamında (`localhost:5432/ticaret_merkezi`, `tm-postgres`).

1. Yedek: `backup-and-rehearse.sh` — yedek okunabilir, geri yükleme satır sayıları eşit (16 tablo). Betiğin Aşama 1'e özgü kontrolleri (başlangıç `companies` bekler) dev artık Aşama 1'de olduğu için başarısız (16/36); CAT-01'i doğrulamaz.
2. CAT-01 izole provası (aynı yedekten `tm_` kopya, sonra silindi): 16/16 — yalnızca CAT-01 bekliyor, uygulama 281 ms, diğer 15 tablonun satırları değişmedi, `tm_app` = `SELECT, INSERT, UPDATE`, rol izinleri doğru, ikinci deploy boş, boş katalogda `down.sql` başarılı.
3. Hedef doğrulandı (`current_database` = `ticaret_merkezi`, `tm_migrator`), `migrate deploy` → CAT-01 uygulandı; `setup-roles.sql` yeniden çalıştırıldı.
4. `.env`'e Mailpit ayarları eklendi (`MAIL_TRANSPORT=smtp`, `127.0.0.1:1025`, `INVITATION_TTL_HOURS`, `QUEUE_*`).
5. Backend ve frontend `f010233` ile başlatıldı; `/health` → `database: up`, `queue: up`.
6. Smoke 30/30: kayıt, `auth/me`, `auth/memberships`, firma, kategori, marka, ürün/varyant, `409 SKU_TAKEN`, davet → Mailpit → lookup → kabul, görüntüleyici `403`, iptal edilmiş davet reddi, başka tenant `404`, mevcut hesapla davet kabulü, mağaza değiştirme, pasif firma `409 COMPANY_INACTIVE`, yeniden aktifleştirme.
   - Dev'de denenmedi (e2e'de kapsanıyor): INF-18 Redis hata enjeksiyonu; pasife alınan üyenin `SESSION_REVOKED` alması (personel pasife alma endpoint'i USR-T11a ile gelir).

**Geri dönüş:** kod için önceki sürümü yeniden başlatmak yeterli (eski kod yeni tabloları kullanmaz). Smoke testi katalogda satır oluşturduğundan `down.sql` artık kendini durdurur; şemayı geri almak için 1. adımdaki yedekten geri yükleme gerekir (yedekten sonraki dev verisi kaybolur).

## 4. Sıradaki görevler (önerilen sıra, 2 akış)

| # | ID | Başlık | Not |
|---|---|---|---|
| 1 | USR-T11a | Users modülü çekirdeği | PR #19 (`DONE-PR`); merge onayı bekler |
| 2 | CAT-03 | Varyant ve özellik yönetimi | CAT-02 tamam; CAT-06 ile paralel |
| 3 | CAT-05 | Fiyat yönetimi | CAT-02 tamam |
| 4 | INT-01 | `ChannelAdapter`, kimlik bilgisi şifreleme | INF-13 (B) bağımlılığı için bkz. R-25 |
| 5 | ORD-01 / INV-01 | Sipariş ve stok şemaları | CAT-01 tamam; migration dev'e uygulanması onay gerektirir |
| 6 | USR-19 | Şifre sıfırlama ve e-posta doğrulama | USR-T9a tamam |
| 7 | INF-12 → IMG-01 | Dosya depolama, görsel yükleme | CAT-02 tamam |

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
| R-04 | Yüksek | (Kapandı: PR #10 merge `113b522`; dev'e deploy edildi `f010233`, 2026-10-30) Mağaza değiştirme sırasında Redis çökerse refresh zinciri yeniden kullanım (token hırsızlığı) olarak algılanabilir → sahte audit kaydı ve kullanıcının tüm cihazlardan çıkışı | Açık | INF-18 |
| R-05 | Yüksek | Redis tek nokta: rate limiting ve BFF oturumu fail-closed; Redis kesintisinde kimse giriş yapamaz | Dev'de tek Redis | INF-14 |
| R-06 | Yüksek | Tenant izolasyonu yeni modüllerde ihlal edilebilir (her yeni tablo/sorgu, kuyruk job'ları, ai-engine istekleri) | Prisma eklentisi + izin listesi testi var; job'lar için yok | INF-09, her modülde S testleri, USR-T14 |
| R-07 | Yüksek | Prod ağ/TLS/proxy yapılandırması yanlışsa IP rate limit herkesi birlikte engeller veya backend internete açılır | Prod yok | INF-17 |
| R-08 | Orta | BFF `forceRefresh` `stillNeeded` yarışı: eşzamanlı isteklerde oturum kapanabilir (kabul edilmiş, düzeltilmedi; MVP'den B'ye ertelendi, pilotta kabul edilmiş risk) | Açık | INF-19 |
| R-09 | Orta | Kayıtta `409` yanıtı e-postanın kayıtlı olduğunu sızdırır (kullanıcı numaralandırma) | Açık | INF-20 |
| R-10 | Orta | CSP `script-src 'unsafe-inline'` | Açık | INF-16 |
| R-11 | Orta | CI var (PR #11); zorunlu kontrol (branch protection) henüz açık değil — depo ayarı, kullanıcı | Kısmen | INF-10 + depo ayarı |
| R-12 | Orta | (Kapandı: 2026-10-30 dev `f010233`'e geçti) Dev ortamı `main`'in gerisinde | Kapandı | — |
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
| 2026-10-30 | USR-T9a (#12 `f9b5889`), USR-T10a (#15 `bc37227`), CAT-01 (#13 `aa02144`), INF-09 (#14 `6fef239`), CAT-02 (#16 `6824f6f`) → DONE-NOT-DEPLOYED | #12–#16 | `main` @ `6824f6f`: unit 283/283, e2e 305/306 (1 skip), fe 84/84 | yok (dev `eda38da`; CAT-01 migration dev DB'ye uygulanmadı) |
| 2026-10-30 | USR-T1…T8, USR-T9a, USR-T10a, USR-17, INF-09, INF-10, INF-18, CAT-01, CAT-02 → DONE-MERGED; CAT-01 migration dev DB'ye uygulandı | #6–#16 | yedek/geri yükleme ok, CAT-01 prova 16/16, smoke 30/30 | dev `f010233` |
| 2026-10-30 | USR-T11a → DONE-PR; OPS-08, USR-21 eklendi (kullanıcı kararı) | [#19](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/19) | CI: unit 283/283, e2e 318/319 (1 skip); yerel users e2e 13/13 ×3; kilitsiz mutasyonda eşzamanlılık testi başarısız (beklenen); bağımsız inceleme 2 tur, açık bulgu yok | yok |
| 2026-10-30 | USR-T12a → DONE-PR | [#22](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/22) | frontend unit 124/124, typecheck ok; CI ✓; bağımsız inceleme 2 tur, açık bulgu yok | yok |
