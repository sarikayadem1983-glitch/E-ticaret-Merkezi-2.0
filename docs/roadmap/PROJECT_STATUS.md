# Proje Durumu

Son güncelleme: 2026-10-30 (PR #10–#16 merge edildi) · Kaynak: `origin/main` @ `6824f6f` · Güncelleme kuralları: `AGENTS.md` → "Yol haritası ve durum takibi".

## 1. Özet

| Ölçü | Değer |
|---|---|
| Toplam EPIC / görev | 33 / 139 (133 + 6 kullanıcı yönetimi MVP dilimi) |
| Tamamlanan | 27 (%19,4) — 11 `DONE-MERGED` (dev'de), 16 `DONE-NOT-DEPLOYED` (USR-T1…T8, USR-17, INF-09, INF-10, INF-18, USR-T9a, USR-T10a, CAT-01, CAT-02; `main`'de, dev'e deploy edilmedi) |
| BLOCKED | 1 — USR-18 (T16 + Aşama 2 migration onayı) |
| Sürüm A (Trendyol-only MVP) ilerleme | 27 / 57 görev merge edildi (16'sı dev'de değil); kalan 30 görev, 89 iş günü; tahmini hedef 2027-01-20 (taahhüt değil; önceki 2027-02-03) |
| Sürüm B / C | 61 / 21 görev |
| Açık PR | #7 roadmap (draft). #12–#16 merge edildi |
| `origin/main` | `6824f6f` (PR #16 merge; #15 `bc37227`, #13 `aa02144`, #14 `6fef239`). `main` CI ✓: backend unit 283/283, e2e 305/306 (1 skip, Mailpit), frontend 84/84 |
| Dev ortamı | Son deploy edilen kod `eda38da` (Task 4). `main` dev'e deploy edilmedi (kullanıcı onayı gerekir) |
| Dev DB şeması | Aşama 1 migration `20261029090000_tenant_memberships` uygulanmış (kullanıcı onayıyla); PR #6/#8/#9 yeni migration getirmez. CAT-01 migration'ı `20261029120000_catalog_schema` `main`'de, dev DB'ye **uygulanmadı** (kullanıcı onayı gerekir) |
| Son testler (`main` @ `6824f6f`, CI) | backend unit 283/283, e2e 305/306 (1 skip); frontend 84/84. Önceki yerel tam tur (`95b5bdb`): build ok; frontend 81/81, lint ok, typecheck ok, `next build` ok; Playwright 13/13 yalnızca `next dev` ile — `next start` (prod modu, http) 11/13: `APP_ORIGIN` https koruması, bkz. R-24 |

### Modül bazında tamamlanma (görev sayısına göre)

| Modül | Tamamlanan / Toplam | % | Not |
|---|---|---|---|
| M01 INF | 11 / 20 | 55 | 8'i dev'de; INF-09, INF-10, INF-18 `main`'de, deploy edilmedi |
| M02 USR | 13 / 28 | 46 | 2'si dev'de; 11'i `main`'de, deploy edilmedi |
| M03 DSH | 1 / 3 | 33 | İskelet |
| M04 CAT | 2 / 6 | 33 | CAT-01, CAT-02 `main`'de, deploy edilmedi; migration dev DB'ye uygulanmadı |
| M05–M20 | 0 / 82 | 0 | Başlanmadı |
| **Toplam** | **27 / 139** | **19,4** | Dev'e deploy edilmiş: 11 / 139 (%7,9) |

## 2. Merge edilen, deploy edilmemiş PR'lar

Hepsi merge commit ile, kullanıcının PR başına ayrı onayıyla merge edildi. **Hiçbiri dev'e deploy edilmedi** (dev `eda38da`).

| PR | Merge | Görevler | İçerik |
|---|---|---|---|
| [#6](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/6) | `f1be19a` | USR-T1…T6, USR-17 | Aşama 1 migration, yedek/prova betiği, global kullanıcı + üyelik, mağaza değiştirme, `auth_version` ile oturum iptali, pasif kullanıcıya token verilmemesi, `setup-roles.sql` boş parola koruması |
| [#8](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/8) | `cc8b72a` | USR-T7 | Rol kataloğu, `AccessService`, `canGrant`, son owner koruması |
| [#9](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/9) | `95b5bdb` | USR-T8 | Companies modülünde firma başına rol kontrolü |
| [#11](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/11) | `9c405bd` | INF-10 | GitHub Actions CI: backend lint/typecheck/unit/e2e (servis PG/Redis), frontend test/lint/typecheck |
| [#10](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/10) | `113b522` | INF-18 | Mağaza değiştirmede Redis hatası: istek 503, refresh zinciri korunur, sahte `REFRESH_REUSE` audit'i yok; reuse işleme kullanıcı satırında serileştirildi |
| [#12](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/12) | `f9b5889` | USR-T9a | `mail` modülü: `MailService.send`, SMTP/log transport, `mail.config` (prod'da `log` yasak, TLS zorunlu), Mailpit (docker) |
| [#15](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/15) | `bc37227` | USR-T10a | `invitations` modülü: oluştur, iptal, yeniden gönder, lookup, kabul; hız sınırı; audit |
| [#13](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/13) | `aa02144` | CAT-01 | Katalog şeması (kategori, marka, ürün, varyant; tenant içinde tekil SKU/barkod) — migration `20261029120000_catalog_schema` + `down.sql`; `setup-roles.sql` katalog yetkileri |
| [#14](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/14) | `6fef239` | INF-09 | `queue` modülü (BullMQ/Redis): tenant context'li job, retry/backoff, ölü kuyruk; `/health` `queue` alanı |
| [#16](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/16) | `6824f6f` | CAT-02 | `catalog` API: `/categories`, `/brands`, `/products` (+ varyantlar); firma rolü izinleri; pasif firma `409 COMPANY_INACTIVE` |

Migration getiren tek PR #13'tür (CAT-01); dev DB'ye **uygulanmadı**. Aşama 2 SQL'i (`migrations-pending/`) uygulanmadı (USR-18).

## 3. Dev deploy önkoşulları (`main` @ `6824f6f`)

Her adım kullanıcı onayı gerektirir; deploy ve migration ayrı onaylardır.

1. Dev DB yedeği: `bash database/scripts/backup-and-rehearse.sh <out-dir>` → çıkış 0 (CAT-01 migration'ı yedek üzerinde prova edilir).
2. `cd backend && npx prisma migrate status` → yalnızca `20261029120000_catalog_schema` bekler. Kullanıcı onayıyla `npx prisma migrate deploy` (`MIGRATION_DATABASE_URL`, `tm_migrator`). Aşama 2 **uygulanmaz**.
3. `database/roles/setup-roles.sql` migration'dan sonra yeniden çalıştırılır: `tm_app` katalog tablolarında yalnızca `SELECT, INSERT, UPDATE` alır (silme yok).
4. Dev `.env`'e yeni ayarlar (değerler commit edilmez, `.env.example`'a bakın):
   - `mail`: `MAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (dev'de Mailpit veya `log`).
   - `invitations`: `INVITATION_TTL_HOURS`.
   - `queue`: `QUEUE_WORKERS`, `QUEUE_SHUTDOWN_TIMEOUT_MS` (Redis `REDIS_URL` üzerinden).
5. Backend'in (`:4000`) ve frontend'in yeni kodla başlatılması için kullanıcı onayı.
6. Smoke test:
   - Önceki: login, `auth/memberships`, mağaza değiştirme, pasife alınan üyenin `SESSION_REVOKED` alması, pasif kullanıcının login/refresh reddi, firma rolüne göre erişim (T8).
   - INF-18: mağaza değiştirme sırasında Redis hatası → `503`, oturum korunur.
   - INF-09: `/health` → `queue: "up"`.
   - USR-T9a/T10a: davet oluştur → e-posta Mailpit'te → kabul; iptal edilen davet kabul edilemez.
   - CAT-02: kategori/marka/ürün oluştur, listele, sil; firma dışı ürün `404`, pasif firmada yazma `409 COMPANY_INACTIVE`.
7. Geri dönüş planı: `eda38da` kodunu yeniden başlat. CAT-01 uygulandıysa önce `down.sql` (`tm_migrator`; katalogda satır varken çalışmaz) ve `_prisma_migrations` satırının silinmesi; gerekirse 1. adımdaki yedekten geri yükleme.
8. Deploy sonrası USR-T1…T8, USR-T9a, USR-T10a, USR-17, INF-09, INF-10, INF-18, CAT-01, CAT-02 `DONE-MERGED` olur; bu dosya ve `TASK_REGISTER.md` güncellenir.

## 4. Sıradaki görevler (önerilen sıra, 2 akış)

| # | ID | Başlık | Not |
|---|---|---|---|
| 1 | USR-T11a | Users modülü çekirdeği | T8 + T10a tamam; CRITICAL |
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
| R-04 | Yüksek | (Kapandı: PR #10 merge `113b522`, dev'e deploy edilmedi) Mağaza değiştirme sırasında Redis çökerse refresh zinciri yeniden kullanım (token hırsızlığı) olarak algılanabilir → sahte audit kaydı ve kullanıcının tüm cihazlardan çıkışı | Açık | INF-18 |
| R-05 | Yüksek | Redis tek nokta: rate limiting ve BFF oturumu fail-closed; Redis kesintisinde kimse giriş yapamaz | Dev'de tek Redis | INF-14 |
| R-06 | Yüksek | Tenant izolasyonu yeni modüllerde ihlal edilebilir (her yeni tablo/sorgu, kuyruk job'ları, ai-engine istekleri) | Prisma eklentisi + izin listesi testi var; job'lar için yok | INF-09, her modülde S testleri, USR-T14 |
| R-07 | Yüksek | Prod ağ/TLS/proxy yapılandırması yanlışsa IP rate limit herkesi birlikte engeller veya backend internete açılır | Prod yok | INF-17 |
| R-08 | Orta | BFF `forceRefresh` `stillNeeded` yarışı: eşzamanlı isteklerde oturum kapanabilir (kabul edilmiş, düzeltilmedi; MVP'den B'ye ertelendi, pilotta kabul edilmiş risk) | Açık | INF-19 |
| R-09 | Orta | Kayıtta `409` yanıtı e-postanın kayıtlı olduğunu sızdırır (kullanıcı numaralandırma) | Açık | INF-20 |
| R-10 | Orta | CSP `script-src 'unsafe-inline'` | Açık | INF-16 |
| R-11 | Orta | CI var (PR #11); zorunlu kontrol (branch protection) henüz açık değil — depo ayarı, kullanıcı | Kısmen | INF-10 + depo ayarı |
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
| 2026-10-30 | USR-T9a (#12 `f9b5889`), USR-T10a (#15 `bc37227`), CAT-01 (#13 `aa02144`), INF-09 (#14 `6fef239`), CAT-02 (#16 `6824f6f`) → DONE-NOT-DEPLOYED | #12–#16 | `main` @ `6824f6f`: unit 283/283, e2e 305/306 (1 skip), fe 84/84 | yok (dev `eda38da`; CAT-01 migration dev DB'ye uygulanmadı) |
