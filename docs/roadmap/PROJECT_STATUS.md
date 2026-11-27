# Proje Durumu

Son güncelleme: 2026-11-22 (dev deploy `ceee47e`) · Kaynak görev durumları TASK_REGISTER.md.

## 1. Özet

| Ölçü | Değer |
|---|---|
| Toplam EPIC / görev | 33 / 142 (133 + 6 kullanıcı yönetimi MVP dilimi + 2 kullanıcı kararı 2026-10-30: OPS-08, USR-21 + USR-19b, 2026-11-14) |
| Tamamlanan | 65 (%45,8) — `DONE-MERGED` |
| BLOCKED | 1 — USR-18 (T16 + Aşama 2 migration onayı) |
| Sürüm A (Trendyol-only MVP) ilerleme | 54 / 59 görev dev'de. Kalan 5: OPS-03 (prod altyapısı), INT-TY-01…03 ve SHP-02 (BLK-01) |
| Sürüm B / C | 62 / 21 görev. B: 12 DONE-MERGED (RPT-02 dahil), 1 BLOCKED (USR-18), 49 PLANNED; C: 21 PLANNED |
| Açık PR | Bu doküman PR'ı (RPT-02 dev deploy kaydı) |
| `origin/main` | `e87ae50` (2026-11-27, PR #106 merge) |
| USR-T11 doğrulama (geçmiş, 2026-11-16) | Kod 3f42e76, CI [43843739033](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/actions/runs/43843739033): unit 571/571, e2e 471 geçti + 1 Mailpit skip, frontend 206/206; build/lint yeşil. Yerel typecheck/lint çıkış 0. CRITICAL bağımsız inceleme temiz |
| USR-T9 testleri (geçmiş, 2026-11-15) | Kod `df54a82`, CI [43745748422](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/actions/runs/43745748422): backend unit 572/572, e2e 467 geçti + 1 Mailpit skip, frontend 198/198; build/lint yeşil. Yerel: mail/davet 30/30, tam unit 572/572, typecheck ve lint çıkış 0. Dev DB kullanılmadı |
| Dev ortamı | `e87ae50` (2026-11-27, kullanıcı onayıyla; #103, #104, #105, #106; migration `20261126200000_variant_purchase_cost` uygulandı, verify.sql 2/2; yedek `tm-backups/deploy-e87ae50/ticaret_merkezi-20261127-152413.dump` (42 tablo eşit); smoke 46/46 `tm-backups/smoke-e87ae50.log`; geri alma: `git checkout 4570e31` + build + yeniden başlatma, şema için `down.sql`). Önceki `4570e31` (2026-11-25, kullanıcı onayıyla; #99 düzeltmesi, migration yok; #100 yalnız doküman). Önceki `3f0c6dc` (2026-11-24, kullanıcı onayıyla; #95 `1a855ad`, #97 `b96aa2d`, #98 `3f0c6dc` sırayla deploy edildi, migration yok). Önceki `ceee47e` (2026-11-22, kullanıcı onayıyla, bkz. §3v); #88–#90 uygulama kodu içermez (CI, test, betik, doküman), yeniden deploy gerekmedi. Smoke: `tm-backups/smoke-ceee47e.log`. Önceki `804886c` (2026-11-22, kullanıcı onayı 2026-11-19, bkz. §3u). Önceki `cb07e60` (2026-11-14, kullanıcı onayıyla, bkz. §3t). Önceki `dc64348` (bkz. §3s). Önceki `70bae17` (2026-11-13, bkz. §3d). Backend `node dist/main` (WMI ile ayrık). Smoke: `tm-backups/smoke-804886c.log`. Önceki: `736cb40` (bkz. §3c) |
| Dev DB şeması | Tüm migration'lar (19) uygulandı; son `20261126200000_variant_purchase_cost` (RPT-02, 2026-11-27, kullanıcı onayıyla). Önceki `20261122170000_product_images` (IMG-01, 2026-11-22, kullanıcı onayıyla; yedek `deploy-ceee47e/ticaret_merkezi-20261122-150035.dump`, izole prova 13/13). Önceki `20261114190000_stock_thresholds`. Önceki `20261113120000_sync_engine` (INT-02, 2026-11-13, kullanıcı onayıyla; yedek `ticaret_merkezi-20261113-210949.dump`, izole prova ok). Önceki `20261112210000_user_tokens` (USR-19, kullanıcı onayıyla; yedek `ticaret_merkezi-20261112-210146.dump`; `migrate status` 2026-11-13: güncel). Önceki `20261112190000_channel_mapping` (CAT-06, 2026-11-12, kullanıcı onayıyla; yedek `ticaret_merkezi-20261112-184613.dump` + izole prova 10/10). Aşama 2 (`migrations-pending/`) uygulanmadı |
| Son testler (`ceee47e`, yerel, 2026-11-22) | backend unit 600/600, e2e 496 geçti + 1 skip (Mailpit); frontend unit 215/215; Playwright 23/23 (çalışan dev), ayrıca eski süre sınırlarıyla izole DB'de 23/23 ×2; smoke 46/46. Önceki (`804886c`, 2026-11-18): unit 591/591, e2e 479 + 1 skip, frontend 208/208 |

### Modül bazında tamamlanma (görev sayısına göre)

| Modül | Tamamlanan / Toplam | % | Not |
|---|---|---|---|
| M01 — SaaS altyapısı ve güvenlik (INF) | 14 / 20 | 70 | Kalanlar PLANNED |
| M02 — Kullanıcılar, firmalar, roller (USR) | 27 / 30 | 90 | USR-18 BLOCKED, 2 PLANNED |
| M03 — Dashboard (DSH) | 2 / 3 | 67 | Kalanlar PLANNED |
| M04 — Ürün kataloğu (CAT) | 6 / 6 | 100 | Tamamı dev'de |
| M05 — AI destekli ürün yükleme (AIU) | 0 / 3 | 0 | Başlanmadı |
| M06 — Toplu içe aktarma: Excel/CSV ve URL (IMP) | 2 / 4 | 50 | Kalanlar PLANNED |
| M07 — Ürün görsel yönetimi (IMG) | 1 / 3 | 33 | Kalanlar PLANNED |
| M08 — Pazaryeri API entegrasyonları (INT) | 3 / 25 | 12 | Kalanlar PLANNED |
| M09 — Siparişler (ORD) | 3 / 4 | 75 | Kalanlar PLANNED |
| M10 — Stok ve depo (INV) | 4 / 4 | 100 | Tamamı dev'de |
| M11 — Kargo, iptal ve iade (SHP) | 0 / 3 | 0 | Başlanmadı |
| M12 — e-Fatura / e-Arşiv ve muhasebe (EFT) | 0 / 5 | 0 | Başlanmadı |
| M13 — Müşteriler ve tedarikçiler (CRM) | 0 / 3 | 0 | Başlanmadı |
| M14 — Kampanya ve reklam (CMP) | 0 / 3 | 0 | Başlanmadı |
| M15 — Kârlılık ve gider hesaplama (PRF) | 0 / 3 | 0 | Başlanmadı |
| M16 — Hakediş ve mutabakat (STL) | 0 / 3 | 0 | Başlanmadı |
| M17 — Raporlama (RPT) | 1 / 4 | 25 | Kalanlar PLANNED |
| M18 — AI asistan ve otomasyonlar (AIE) | 0 / 4 | 0 | Başlanmadı |
| M19 — Abonelik ve ödeme (SUB) | 0 / 4 | 0 | Başlanmadı |
| M20 — Sistem yönetimi, izleme ve güvenlik (OPS) | 2 / 8 | 25 | OPS-03 IN PROGRESS, kalanlar PLANNED |
| **Toplam** | **65 / 142** | **45,8** | TASK_REGISTER kanonik tablolarından sayıldı (2026-11-22) |

## 2. Merge edilen, deploy edilmemiş PR'lar

| PR | Konu | Merge | Not |
|---|---|---|---|

Önceki: #103–#106 2026-11-27'de dev `e87ae50`'ye deploy edildi. #25–#30 (`5ac1401`) 2026-11-12'de dev'e deploy edildi. #6–#16 (`f010233`), #19 (`8fc7ae3`), #22 ve #23 (`0437c16`) 2026-10-30'da dev'e deploy edildi ve bu tablodan çıkarıldı; ayrıntı §3 ve §6.

Aşama 2 SQL'i (`migrations-pending/`) uygulanmadı (USR-18).

## 3v. Dev deploy kaydı (2026-11-22, `main` @ `ceee47e`)

Yalnızca dev ortamında, kullanıcı onayıyla (merge, migration ve deploy). Prod'a dokunulmadı.

| İş | Merge | Dev deploy | Doğrulama |
|---|---|---|---|
| Next.js 16.4.6 (#84) | `f5b7bae` | `ceee47e` | Playwright 23/23 dev'de; eski sınırlarla (test 60 sn, beklenti 5 sn) izole DB'de iki ardışık tur 23/23 |
| OPS-03 dev dilimi (#85) | `f708d47` | Betik; servis yok | `backup.sh` bu deploy'da kullanıldı: 41 tablo geri yüklemede eşit. Prod kısmı, zamanlayıcı, temiz küme ve nesne arşivi geri yüklemesi doğrulanmadı |
| IMG-01 + INF-12 canlı testler (#86) | `e341cc1` | `ceee47e` + migration | İzole prova 13/13; deploy sonrası verify.sql 4/4, eski 40 tablonun satır sayısı değişmedi; smoke'ta yükleme, imzalı URL 200, imzasız 403, başka tenant 404, silme, nesne 404 |
| USR-T13 / USR-T15 (#87) | `ceee47e` | `ceee47e` | Playwright davet, rol değişikliği ve mobil kart testleri |

Yedekler: `tm-backups/deploy-ceee47e/` (DB + nesne arşivi), `tm-backups/rehearse-ceee47e/`. Backend e2e 496 + 1 skip, unit 600/600; frontend unit 215/215. Smoke 46/46 (`tm-backups/smoke-ceee47e.log`). Playwright CI'da koşmuyor; CI'da MinIO olmadığından canlı depolama testi orada atlanır.

Test süresi artışı (#84): `ceee47e` artışsız da geçiyor; mevcut testlerde artışın gizlediği bir hata görülmedi. #84'ün ilk turlarındaki düşüşlerden biri (`users.spec.ts` davet iptali, `revoked.ok()`) zaman aşımı değil başarısız HTTP yanıtıydı; o turun yanıt kodu saklanmadığı için nedeni kesinleşmedi, `ceee47e` üzerindeki üç turda tekrarlamadı. `next start` http'de çalışmadığından (R-24) prod modunda Playwright koşulmadı.

Geri alma: `git checkout 071ad34`, `npm ci` + backend build + yeniden başlatma (migration yalnızca tablo ve indeks ekler). Şema geri alma: `down.sql` yalnızca `product_images` boşken çalışır; doluysa durur.

## 3u. Dev deploy kaydı (2026-11-22, `main` @ `804886c`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-19). #73, #74, #75, #77, #78, #79, #80, #81, #82. Migration yok. 2026-11-19 denemesi zaman aşımına uğradı, 2026-11-22'de tamamlandı. Yedek: `tm-backups/deploy-804886c/ticaret_merkezi-20261119.dump`. Backend build + başlatma; `/health` ok; smoke tümü geçti (`tm-backups/smoke-804886c.log`). Frontend `npm run dev`: `/login` ve `/forgot-password` 200. Playwright koşulmadı. INF-12: MinIO konteyneri ve `STORAGE_*` ayarları dev'de yok, nesne depolama doğrulanmadı. `npm audit`: `next@16.4.1` 7 advisory (moderate), düzeltme `16.4.6`. Geri alma: `git checkout cb07e60`, backend build + yeniden başlatma.

## 3t. Dev deploy kaydı (2026-11-14, `main` @ `cb07e60`)

Yalnızca dev ortamında, kullanıcı onayıyla. #71 INV-04 (stok transferi ve sayımı, API). Migration yok. PR CI ✓. Backend build + yeniden başlatma; `/health` ok; smoke 32/32 (`tm-backups/smoke-cb07e60.log`). Geri alma: `git checkout e6a85b2`, backend build + yeniden başlatma.

## 3s. Dev deploy kaydı (2026-11-14, `main` @ `dc64348`)

Yalnızca dev ortamında, kullanıcı onayıyla. #69 IMP-04 (ürün ve stok CSV dışa aktarma). Migration yok. PR CI ✓. Backend build + yeniden başlatma; `/health` ok. Smoke (giriş hız sınırı penceresi dolduktan sonra tek koşu, `tm-backups/smoke-a9edbe5.log`, `a9edbe5` + `dc64348` kodunu kapsar): 32/32. Geri alma: `git checkout ad4c803`, backend build + yeniden başlatma.

## 3r. Dev deploy kaydı (2026-11-14, `main` @ `a9edbe5`)

Yalnızca dev ortamında, kullanıcı onayıyla. #67 (profil: e-posta doğrulama durumu ve yeniden gönderme; `/auth/me` `emailVerified`). Migration yok. PR CI ✓. Backend build + yeniden başlatma; `/health` ok. İlk smoke denemesi giriş ucunun IP hız sınırına (429, gün boyu çok sayıda test girişi) takıldı — uygulama hatası değil; pencere dolduktan sonra tekrar koşuldu: bkz. `tm-backups/smoke-a9edbe5.log`. Geri alma: `git checkout dab71fe`, backend build + yeniden başlatma.

## 3q. Dev deploy kaydı (2026-11-14, `main` @ `4c029c0`)

Yalnızca dev ortamında, kullanıcı onayıyla. #64 DSH-02 (KPI uç noktası + dashboard kartları) ve #65 (Modüller paneli: Siparişler ve Ürünler/Stok "Açık"). Migration yok. Her iki PR CI ✓. Backend build + yeniden başlatma; `/health` ok; smoke 32/32. Arayüz (masaüstü + mobil, konsol hatası yok): test hesabında Bugünkü satış 909,50 ₺ / 2 sipariş (rapor ile aynı), Kargo bekleyen 2, Düşük stok 1, Entegrasyon hatası 0. Geri alma: `git checkout cd83fea`, backend build + yeniden başlatma.

## 3p. Dev deploy kaydı (2026-11-14, `main` @ `cd83fea`)

Yalnızca dev ortamında, kullanıcı onayıyla. #62 USR-19b (yalnızca frontend; migration yok). PR CI ✓. Frontend `npm run dev` dosyaları sıcak yükledi; `/forgot-password`, `/reset-password/*`, `/verify-email/*` oturumsuz 200. Uçtan uca (yerel dev + Mailpit, `tm-backups/ui-recovery.mjs`): şifremi unuttum → bağlantı → yeni şifre → aynı bağlantı ikinci kez reddedildi → yeni şifreyle giriş. Geri alma: `git checkout 0376db8`.

## 3o. Dev deploy kaydı (2026-11-14, `main` @ `cfb9689`)

Yalnızca dev ortamında, kullanıcı onayıyla. #60 (R-26: katalog yazımında serileştirme çakışmasında yeniden deneme). Migration yok. PR CI ✓; backend build + yeniden başlatma; `/health` ok; smoke 32/32 (`tm-backups/smoke-cfb9689.log`). Geri alma: `git checkout e14612e`, backend build + yeniden başlatma.

## 3n. Dev deploy kaydı (2026-11-14, `main` @ `ce85f36`) — süreç sapması

**Sapma:** OPS-01 commit'i (`ce85f36`) yanlışlıkla yerel `main` üzerinde oluşturulup doğrudan `origin/main`'e push edildi; PR açılmadı (AGENTS.md: "main'e doğrudan push yapılmaz"). Fark edildiğinde geçmiş yeniden yazılmadı (paylaşılan dalda force push yıkıcı olurdu). Telafi: push sonrası `main` CI koşusu ✓ (backend, frontend) doğrulandı; değişiklik aynı testlerden geçmişti. Önlem: branch protection (R-11) açılırsa bu tür push engellenir — kullanıcı yapılacaklar listesinde.

- Testler (commit öncesi, yerel): backend unit 563/563 (maskeleme 16, logger 4), izole e2e 458/459 (1 skip Mailpit; ilk koşuda R-26 kararsızlığı, tekrar koşu temiz), lint 0, build ok.
- Migration yok. Backend build + yeniden başlatma (log `tm-backups/backend-ce85f36.log`); `/health` 200 ve `X-Request-Id` başlığı var.
- Smoke (`tm-backups/smoke-ce85f36.log`): 32/32. Logda erişim satırları var; smoke e-postaları logda görünmüyor.
- Geri alma: `git checkout 0568b56`, backend build + yeniden başlatma.

## 3m. Dev deploy kaydı (2026-11-14, `main` @ `0568b56`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `dfdd154` → `0568b56`: #57 IMP-01 (içe aktarma modülü + `/products/import`). Migration yok.

- PR CI ✓. Backend build + yeniden başlatma (log `tm-backups/backend-imp01.log`); `/health` ok. Frontend sıcak yükledi.
- Smoke (`tm-backups/smoke-imp01.log`): 32/32.
- Arayüz uçtan uca (`tm-backups/ui-import.mjs`, yerel test hesabı): formül hücreli/eksik SKU'lu/yanlış KDV'li dosya → 3 hata satır/kolon bazında, hiçbir şey kaydedilmedi; temiz dosya → kontrol → içe aktar → 1 ürün (2 varyant) oluşturuldu; konsol hatası yok.
- Pazaryerine istek gönderilmedi.
- Geri alma: `git checkout dfdd154`, backend build + yeniden başlatma.

## 3l. Dev deploy kaydı (2026-11-14, `main` @ `ad4de17`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `a89a090` → `ad4de17`: #55 INV-03 (migration `20261114190000_stock_thresholds` + stok ekranı).

- PR CI ✓.
- Yedek + prova: `backup-and-rehearse.sh tm-backups/deploy-inv03` → **12/12**. Yedek `tm-backups/deploy-inv03/ticaret_merkezi-20261114-163344.dump`.
- Dev DB: 1 migration uygulandı, `migrate status` güncel. Backend generate + build + yeniden başlatma (log `tm-backups/backend-ad4de17.log`); `/health` ok. Frontend sıcak yükledi.
- Smoke (`tm-backups/smoke-ad4de17.log`): 32/32.
- Arayüz: `/stock` masaüstü ve mobil, konsol hatası yok; test hesabında eşik altı ürün listesi ve uyarı bandı doğru (3 / eşik 5).
- Pazaryerine istek gönderilmedi.
- Geri alma: dump restore + `git checkout a89a090`, backend build + yeniden başlatma.

## 3k. Dev deploy kaydı (2026-11-14, `main` @ `633f250`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `24a900a` → `633f250`: #53 RPT-01 (backend rapor modülü + frontend `/reports`). Migration yok.

- PR CI ✓. Backend build + yeniden başlatma (log `tm-backups/backend-rpt01.log`); `/health` ok. Frontend dev sunucusu sıcak yükledi.
- Smoke (`tm-backups/smoke-rpt01.log`): 32/32.
- Arayüz: `/reports` masaüstü ve mobil, konsol hatası yok; test hesabında 2 sipariş, ciro 909,50 ₺ (709,60 + 199,90) doğru.
- Pazaryerine istek gönderilmedi.
- Geri alma: `git checkout 24a900a`, backend build + yeniden başlatma.

## 3j. Dev deploy kaydı (2026-11-14, `main` @ `9d4eb11`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `c05567e` → `9d4eb11`: #51 INV-02 (migration `20261114170000_stock_reservations` + stok API + sipariş entegrasyonu).

- Merge öncesi PR CI ✓; bağımsız CRITICAL inceleme 2. tur APPROVE.
- Yedek + prova: `backup-and-rehearse.sh tm-backups/deploy-inv02` → **14/14** (verify.sql 5/5, eski tablolar değişmedi, ikinci deploy no-op, down.sql şemayı birebir geri getirdi, dolu veride durdu). Yedek `tm-backups/deploy-inv02/ticaret_merkezi-20261114-161110.dump`.
- Dev DB: `prisma migrate deploy` 1 migration uyguladı, `migrate status` güncel.
- Backend `prisma generate` + build + yeniden başlatma (log `tm-backups/backend-9d4eb11.log`); `/health` ok. Frontend değişmedi.
- Smoke (`tm-backups/smoke-9d4eb11.log`): 32/32 — önceki 26 + INV-02: depo oluşturma, açılış hareketi, sipariş rezervasyonu (5 stok, 2 ayrıldı, 3 kullanılabilir), kargolama sonrası 3/0, eksi stok 409.
- Pazaryerine istek gönderilmedi.
- Geri alma: dump restore + `git checkout c05567e`, backend build + yeniden başlatma.

## 3i. Dev deploy kaydı (2026-11-14, `main` @ `75ce1de`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `5769db9` → `75ce1de`: #49 ORD-03 (frontend sipariş ekranları + ORD-02 kalem sıralaması düzeltmesi). Migration yok.

- PR CI: ilk koşu backend e2e'de kararsız (aynı INSERT'te oluşan kalemlerin sırası); `created_at, sku` sıralamasıyla düzeltildi, ikinci koşu ✓.
- Backend build + `node dist/main` WMI ile yeniden başlatıldı (log `tm-backups/backend-75ce1de.log`); `/health` ok. Frontend `npm run dev` (çalışıyordu) dosyaları sıcak yükledi.
- Smoke (`tm-backups/smoke-75ce1de.log`): 26/26. Not: kayıt ucu IP başına saatte 5 ile sınırlı olduğundan smoke betiği artık kayıtlı iki test hesabıyla giriş yapıyor (ilk deneme 429 aldı; uygulama hatası değil).
- Arayüz (Playwright betiği `tm-backups/ui-shots.mjs`, yerel test hesabı): `/orders`, `/orders/[id]`, `/orders/new` masaüstü 1280 ve mobil 390; konsol hatası yok; ekran görüntüleri `tm-backups/ui-shots/`.
- Pazaryerine istek gönderilmedi.
- Geri alma: `git checkout 9062bb6`, backend build + yeniden başlatma.

## 3h. Dev deploy kaydı (2026-11-14, `main` @ `9062bb6`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `8ec267e` → `9062bb6`: #47 ORD-02 (yalnızca backend kodu). **Migration yok** (`git diff 8ec267e 9062bb6 -- database backend/prisma` boş), yedek gerekmedi.

- Merge öncesi PR CI ✓.
- Backend `prisma generate` + build, `node dist/main` WMI ile ayrık yeniden başlatıldı (log `tm-backups/backend-9062bb6.log`); `/health` ok. Frontend değişmedi.
- Smoke (`tm-backups/smoke-9062bb6.log`): 26/26 — önceki 21 + ORD-02: elle sipariş 201 (2 × 50.05 + 9.90 = 110.00), durum değişimi 200 ve geçmiş 2 satır, geçersiz geçiş 409 `ORDER_TRANSITION_INVALID`, başka tenant 404, durum filtresiyle liste.
- Pazaryerine istek gönderilmedi.
- Geri alma: `git checkout 458ee82`, backend build + yeniden başlatma.

## 3g. Dev deploy kaydı (2026-11-14, `main` @ `458ee82`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-14 peşin onay). `0fb0c58` → `458ee82`: #45 OPS-08 (yalnızca betik), #44 INV-01 (migration `20261114150000_inventory_schema`).

- Merge öncesi her iki PR CI ✓; INV-01 bağımsız CRITICAL inceleme 2. tur APPROVE.
- Yedek ve prova ilk kez yeni betikle: `bash database/scripts/backup-and-rehearse.sh tm-backups/deploy-458ee82` → **14/14**: yedek okunur, geri yükleme 36 tablo eşit; bekleyen yalnızca INV-01; uygulandı; `verify.sql` 5/5 (tablolar, append-only, stock_levels salt okunur, 5 tetikleyici, boş tablolar); eski 35 tablo satır sayıları değişmedi; ikinci deploy no-op; `down.sql` şemayı birebir geri getirdi; `rehearsal-seed.sql` ile dolu veride `down.sql` durdu ve hiçbir şey değişmedi. Yedek: `tm-backups/deploy-458ee82/ticaret_merkezi-20261114-151732.dump`.
- Dev DB: `prisma migrate deploy` 1 migration uyguladı, `migrate status` güncel.
- Backend `prisma generate` + build, `node dist/main` WMI ile ayrık yeniden başlatıldı (log `tm-backups/backend-458ee82.log`); `/health` ok. Frontend değişmedi.
- Smoke (`tm-backups/smoke-458ee82.log`): 21/21.
- Pazaryerine istek gönderilmedi.
- Geri alma: dump restore + `git checkout 93c03b1`, backend build + yeniden başlatma.

## 3f. Dev deploy kaydı (2026-11-14, `main` @ `93c03b1`)

Yalnızca dev ortamında, kullanıcı onayıyla (kullanıcı 2026-11-14 tüm deploy ve migration adımlarını peşin onayladı). `65fcf85` → `93c03b1`: #41 (doküman), #42 ORD-01 (migration `20261114120000_orders_schema`).

- Merge öncesi PR CI ✓; bağımsız CRITICAL inceleme 2. tur APPROVE.
- Yedek `tm-backups/ticaret_merkezi-20261114-145818.dump`.
- İzole prova (`tm_ord01_rehearsal`, sonra silindi): geri yükleme tam satır sayımı dev ile eşit (33 tablo); yalnızca ORD-01 bekliyordu ve uygulandı; ikinci deploy no-op; eski tabloların satırları değişmedi; `tm_app` orders DELETE yok, history UPDATE yok, INSERT var; `down.sql` ok (tablolar ve `product_variants_tenant_id_company_id_id_key` kaldırıldı), yeniden uygulama ok.
- Dev DB: hedef doğrulandı (`ticaret_merkezi`), `prisma migrate deploy` 1 migration uyguladı, `migrate status` güncel.
- Backend `prisma generate` + build, `node dist/main` WMI ile ayrık yeniden başlatıldı (log `tm-backups/backend-93c03b1.log`); `/health` ok. Frontend değişmedi, yeniden başlatılmadı.
- Smoke (`tm-backups/smoke-93c03b1.log`): 21/21.
- Pazaryerine istek gönderilmedi.
- Geri alma: dump restore + `git checkout 65fcf85`, backend build + yeniden başlatma.

## 3e. Dev deploy kaydı (2026-11-14, `main` @ `65fcf85`)

Yalnızca dev ortamında, kullanıcı onayıyla. `70bae17` → `65fcf85`: #40 INT-03 (backend bağlantı testi ucu + frontend entegrasyon ekranı). **Migration yok** (`git diff 70bae17 65fcf85 -- backend/prisma database` boş), bu yüzden yedek gerekmedi.

- Merge öncesi PR CI ✓ (backend, frontend).
- Docker Desktop kapalıydı, başlatıldı (`tm-postgres`, `tm-redis`, `tm-mailpit`).
- Backend `prisma generate` + build, `node dist/main` WMI ile ayrık başlatıldı (log `tm-backups/backend-65fcf85.log`); `/health` ok (database up, queue up).
- Frontend `npm run dev` ayrık başlatıldı (log `tm-backups/frontend-65fcf85.log`); `/login` 200. :3000 bu kez boştu.
- Smoke (`tm-backups/smoke-65fcf85.log`, betik artık kalıcı: `tm-backups/smoke.mjs`): 21/21 — health, kayıt ×2, me, üyelik, firma ×2, kategori, ürün, `409 SKU_TAKEN`, başka tenant ürün 404; INT-03: kanal tanımları (sır/desen yok), hesap oluşturma 201 ve yanıt maskeli, bağlantı testi `SYNC_LIVE_CALLS_DISABLED`, başka tenant 404, token yok 401, sync-jobs listesi 200 ve başka tenant 404.
- Pazaryerine istek gönderilmedi; `SYNC_LIVE_CALLS` kapalı.
- Geri alma: `git checkout 70bae17`, backend build + yeniden başlatma, frontend yeniden başlatma (DB değişmedi).

## 3d. Dev deploy kaydı (2026-11-13, `main` @ `70bae17`)

Yalnızca dev ortamında, kullanıcı onayıyla. `736cb40` → `70bae17`: #37 (doküman), #38 INT-02 (backend + migration; frontend ve bağımlılıklar değişmedi).

- Merge öncesi: #38 head `d3416cb` CI ✓; bağımsız CRITICAL inceleme 2. tur APPROVE.
- Yedek `tm-backups/ticaret_merkezi-20261113-210949.dump` (31 tablo verisi).
- İzole prova (`tm_int02_rehearsal`, sonra silindi): yedekten geri yükleme satır sayıları dev ile eşit; yalnızca `20261113120000_sync_engine` bekliyordu ve uygulandı; ikinci deploy no-op; eski tablo satırları değişmedi; `tm_app` DELETE yok; `down.sql` ok, yeniden uygulama ok.
- Dev DB: hedef doğrulandı (`ticaret_merkezi`), `prisma migrate deploy` 1 migration uyguladı, `migrate status` güncel.
- Backend `prisma generate` + build, `node dist/main` WMI ile başlatıldı (önceki backend süreci zaten kapalıydı); `/health` ok (database up, queue up); sync-jobs uçları yüklendi.
- Frontend yeniden başlatılmadı: değişiklik yok ve :3000 başka bir projenin süreci tarafından kullanılıyor (dokunulmadı).
- Smoke (`smoke-70bae17.log`): 22/22 — kayıt, me, üyelik, firma, kategori, ürün, `409 SKU_TAKEN`, başka tenant 404, kanal hesabı (maskeli), sync-jobs listesi/filtre, geçersiz durum 422, yabancı imleç 422, bilinmeyen retry 404, başka tenant/hesap 404, token yok 401. USR-19 tekrar: sıfırlama 204, doğrulama 204, eski şifre 401, yeni 200 (betik Mailpit aramasında eski maili seçtiği için elle doğrulandı).
- Pazaryerine istek gönderilmedi; `SYNC_LIVE_CALLS` kapalı.
- Geri alma: dump restore + `git checkout 736cb40`, backend build + yeniden başlatma.

## 3c. Dev deploy kaydı (2026-11-12/13, `main` @ `736cb40`)

Yalnızca dev ortamında, kullanıcı onayıyla (2026-11-13). `8ee40bb` → `736cb40`: #35 (doküman), #36 USR-19 (backend + migration `20261112210000_user_tokens` + `next.config` başlıkları).

- 2026-11-12: yedek `tm-backups/ticaret_merkezi-20261112-210146.dump`, migration uygulandı, backend build (`dist` 21:06). Smoke yarıda kaldı (`smoke-736cb40.log`, `invitation_create` sonrası); backend 22:36'da kapandı.
- 2026-11-13: `migrate status` güncel. Backend `node dist/main` WMI ile ayrık yeniden başlatıldı, `/health` ok (database up, queue up); frontend `npm run dev` yeniden başlatıldı.
- USR-19 smoke (`smoke-usr19-736cb40.log`): kayıt 201; doğrulama isteği 202 → Mailpit → `email/verify` 204, aynı token tekrar 400; bilinmeyen adresle `password/forgot` 202 (aynı yanıt); `password/reset` 204; sonra eski şifre 401, yeni şifre 200. `/reset-password/*`, `/verify-email/*` → `Referrer-Policy: no-referrer` (sayfa henüz yok, 307).
- Genel 44'lük smoke bu turda yeniden koşulmadı (betik bulunamadı).
- Geri alma: dump restore + `git checkout 8ee40bb`, backend build + yeniden başlatma, frontend yeniden başlatma.

## 3. Dev deploy kaydı (2026-11-12, `main` @ `8ee40bb`)

Yalnızca dev ortamında, kullanıcı onayıyla. `7b3c0b9` → `8ee40bb`: #33 (doküman), #34 CAT-06 (backend + migration).

- Yedek `tm-backups/ticaret_merkezi-20261112-184613.dump`; izole prova (`tm_cat06_rehearsal`, silindi) 10/10.
- `prisma migrate deploy`: `20261112190000_channel_mapping` uygulandı. Backend build, `node dist/main` WMI ile ayrık başlatıldı; health ok.
- Smoke (run `mwds9z5g`): 43/44 (bilinen bayat token FAIL). CAT-06: ağaç içe aktarma 200, eşleme 200, hazırlık önce `VALUE_MISSING`, değer sonrası `ready=true`.
- Geri alma: dump restore + `git checkout 7b3c0b9`, backend build + yeniden başlatma.

## 3b. Önceki dev deploy kaydı (2026-11-12, `main` @ `7b3c0b9`)

Yalnızca dev ortamında, kullanıcı onayıyla. `5ac1401` → `7b3c0b9`: #31 (doküman), #32 INT-01 (backend + migration; frontend değişmedi).

- Yedek: `tm-backups/ticaret_merkezi-20261112-180524.dump`. İzole prova (`tm_int01_rehearsal`, silindi): 10/10 — yalnızca 1 migration bekliyordu, eski satırlar değişmedi, ikinci deploy no-op, `down.sql` ok.
- `.env`: `CHANNEL_KEKS` / `CHANNEL_KEK_ACTIVE` eklendi (değer yazdırılmadı; eski `.env` yedeği `tm-backups/env-before-kek-*.bak`).
- Dev DB: hedef doğrulandı (`ticaret_merkezi`), `prisma migrate deploy` 1 migration uyguladı. Backend `npm ci` + `prisma generate` + build; `node dist/main` WMI ile ayrık başlatıldı (ilk denemede Redis zaman aşımı sonrası süreç kapandı). `GET /api/v1/health` → ok.
- Smoke (run `mwdoucow`): 43/44 (bilinen bayat token FAIL). INT-01: hesap oluşturma 201, yanıt maskeli (`••••`), başka tenant 404, silme 204.
- Geri alma: dump restore + `git checkout 5ac1401`, backend build + yeniden başlatma.

## 3a. Önceki dev deploy kaydı (2026-11-12, `main` @ `5ac1401`)

Yalnızca dev ortamında, kullanıcı onayıyla. `0437c16` → `5ac1401`: #25 USR-T13a, #26 USR-T15a, #28 USR-T16, #27 CAT-03, #29 CAT-05, #30 CAT-04, #24 doküman.

- Yedek: `tm-backups/ticaret_merkezi-20261112-115602.dump`.
- İzole prova (`tm_cat0305_rehearsal`, sonra silindi): 11/11 ok — yalnızca 2 migration bekliyordu, eski tablo satırları değişmedi, ikinci deploy no-op, iki `down.sql` ters sırayla ok.
- Dev DB: hedef doğrulandı (`ticaret_merkezi`, `tm_migrator`, 5432); `prisma migrate deploy` 2 migration uyguladı, `migrate status` güncel.
- Backend `npm ci` + build, `node dist/main`; frontend `npm ci`, `npm run dev`. `GET /api/v1/health` → ok, database up, queue up.
- Smoke (run `mwdctwo3`): 43/44. Tek FAIL `other_tenant_users_403_or_404` 401 (bilinen bayat token script hatası). Taze tenant ile yeniden kontrol: deactivate 404 `NOT_FOUND`, listede sızıntı yok.
- Geri alma: dump restore + `git checkout 0437c16`, backend build + yeniden başlatma, frontend yeniden başlatma.

## 3b. Önceki dev deploy kaydı (2026-10-30, `main` @ `0437c16`)

Yalnızca dev ortamında, kullanıcı onayıyla. `8fc7ae3` → `0437c16`: #22 (frontend BFF route'ları, `next.config` içinde `/invite/*` için `Referrer-Policy: no-referrer`) ve #23 (yalnızca testler). `git diff 8fc7ae3 0437c16 -- database backend/prisma` ve lock dosyaları boş, yani **migration yok**.

- Deploy öncesi `main` CI (`0437c16`) ✓: fe 124/124, unit 283/283, e2e 331/332 (1 skip).
- Backend `npm run build` ok, `node dist/main` yeniden başlatıldı; frontend `npm run dev` yeniden başlatıldı.
- `GET /api/v1/health` 200; `/invite/x` yanıtında `Referrer-Policy: no-referrer` var.
- Smoke (run `mvv8euz4`): 43/44. Tek FAIL `other_tenant_users_403_or_404` 401: script bayat B token'ı kullanıyor (önceki deploy'daki bilinen script hatası). Taze B oturumuyla yeniden kontrol: A üyesine deactivate 404, access PUT 404, listede sızıntı yok.
- Geri alma: `git checkout 8fc7ae3`, backend build + yeniden başlatma, frontend yeniden başlatma. DB değişmediği için dump gerekmez.

### Önceki deploy (`8fc7ae3`)

Yalnızca dev ortamında. Bu deploy için kullanıcı onayı kayıtlı değil: sohbette ya da dokümanda kanıtı yok, bu yüzden "kullanıcı onayıyla" yazılmadı. `f010233` → `8fc7ae3`: yalnızca backend (`users` modülü) ve dokümanlar değişti. `git diff f010233 8fc7ae3 -- frontend database backend/prisma` boş, yani **migration yok**.

Doğrulanabilir kanıt (2026-10-30, sonradan kontrol edildi):

1. Dev klasörü: `git reflog` → `8fc7ae3 HEAD@{2026-10-30 15:09:34 +0300}: merge origin/main: Fast-forward`; `HEAD` = `8fc7ae3`. Backend ağacı PR #19 head'i `6225ba4` ile aynı.
2. Build: `backend/dist/main.js` 15:10:05'te üretildi; `dist/users` mevcut.
3. Süreç: PID 2404 `node dist/main`, başlama 15:10:37, `:4000` dinliyor. Log `tm-backups/backend-8fc7ae3.log` (`.err` boş). Logda `/api/v1/users` (`GET`), `/users/:userId/access` (`PUT`), `/users/:userId/deactivate` ve `/activate` (`POST`) eşlendi; `Nest application successfully started`.
4. `GET /api/v1/health` → `status: ok`, `database: up`, `queue: up`.
5. Frontend (`:3000`, PID 2608, 12:25'te başlatıldı) yeniden başlatılmadı; `frontend/` değişmedi.

GitHub'daki merge commit saati (15:11:15) yerel fast-forward saatinden (15:09:34) sonra görünüyor. SHA aynı olduğundan bu fark saat sapması olarak değerlendirildi.

**Doğrulanamayan:** smoke testi. Oturum içinde 44 kontrol çalıştırıldığı bildirildi (önceki 30 + USR-T11a: üye listesi, görüntüleyici `403`, `TOKEN_STALE`, `SESSION_REVOKED`, `SELF_CHANGE`, `ROLE_NOT_GRANTABLE`, başka tenant `404`). Oturum notuna göre ilk tur 43/44 geçti; başarısız kontrolün eskimiş test token'ından kaynaklandığı bildirildi; taze oturumla yeniden denendi (`404`). Çıktı kaydedilmedi; sonuç doğrulanamadı.

**Geri dönüş:** kod için `f010233` ile backend'i yeniden başlatmak yeterli (şema aynı).

### Önceki deploy (2026-10-30, `main` @ `f010233`)

Kullanıcı onayıyla, yalnızca dev ortamında (`localhost:5432/ticaret_merkezi`, `tm-postgres`).

1. Yedek: `backup-and-rehearse.sh` — yedek okunabilir, geri yükleme satır sayıları eşit (16 tablo). Betiğin Aşama 1'e özgü kontrolleri (başlangıç `companies` bekler) dev artık Aşama 1'de olduğu için başarısız (16/36); CAT-01'i doğrulamaz.
2. CAT-01 izole provası (aynı yedekten `tm_` kopya, sonra silindi): 16/16 — yalnızca CAT-01 bekliyor, uygulama 281 ms, diğer 15 tablonun satırları değişmedi, `tm_app` = `SELECT, INSERT, UPDATE`, rol izinleri doğru, ikinci deploy boş, boş katalogda `down.sql` başarılı.
3. Hedef doğrulandı (`current_database` = `ticaret_merkezi`, `tm_migrator`), `migrate deploy` → CAT-01 uygulandı; `setup-roles.sql` yeniden çalıştırıldı.
4. `.env`'e Mailpit ayarları eklendi (`MAIL_TRANSPORT=smtp`, `127.0.0.1:1025`, `INVITATION_TTL_HOURS`, `QUEUE_*`).
5. Backend ve frontend `f010233` ile başlatıldı; `/health` → `database: up`, `queue: up`.
6. Smoke 30/30: kayıt, `auth/me`, `auth/memberships`, firma, kategori, marka, ürün/varyant, `409 SKU_TAKEN`, davet → Mailpit → lookup → kabul, görüntüleyici `403`, iptal edilmiş davet reddi, başka tenant `404`, mevcut hesapla davet kabulü, mağaza değiştirme, pasif firma `409 COMPANY_INACTIVE`, yeniden aktifleştirme.
   - Dev'de denenmedi (e2e'de kapsanıyor): INF-18 Redis hata enjeksiyonu; pasife alınan üyenin `SESSION_REVOKED` alması (personel pasife alma endpoint'i USR-T11a ile gelir).

**Geri dönüş:** kod için önceki sürümü yeniden başlatmak yeterli (eski kod yeni tabloları kullanmaz). Smoke testi katalogda satır oluşturduğundan `down.sql` artık kendini durdurur; şemayı geri almak için 1. adımdaki yedekten geri yükleme gerekir (yedekten sonraki dev verisi kaybolur).

## 4. Sıradaki görevler (2026-11-22)

| # | ID | Başlık | Engel / not |
|---|---|---|---|
| 1 | — | INF-12, IMG-01 tamamlandı | Dev'de doğrulandı (§3v) |
| 2 | INT-TY-01 → 02 → 03 → SHP-02 | Trendyol ürün, stok/fiyat, sipariş, kargo | BLK-01: stage/IP erişimi; pazaryerine yazma her adımda kullanıcı onayıyla |
| 3 | OPS-03 | Dev dilimi ve temiz ortam tatbikatı merge edildi (#85, #90) | Kalan: prod altyapı kararı (WAL/PITR, uzak şifreli kopya), zamanlayıcı (kullanıcı kararıyla şimdilik kurulmadı) |
| 4 | IMP-02, RPT-02, CRM-01, SHP-01 | Sürüm B: asenkron içe aktarma, stok raporu, müşteri (KVKK), iade akışı | Sürüm A sonrası |
| 5 | USR-18 | Aşama 2 migration (eski kullanıcı kolonları) | BLOCKED, onay |

**Dış iş (kullanıcı, hemen):** Trendyol satıcı hesabı, API anahtarı ve stage erişimi / IP whitelist başvurusu — MVP'nin ana dış kapısı, en geç ≈ 2026-12-14 (INT-TY-01 başlangıcı).

## 4a. Dış blokajlar

| ID | Blokaj | Durum (2026-10-29) | Etkilenen görevler | Kim |
|---|---|---|---|---|
| BLK-01 | Trendyol satıcı hesabı, API key/secret, satıcı ID; stage ortamı ve IP whitelist | `apigw.trendyol.com` 401 (erişilebilir, kimlik yok) · `stageapigw.trendyol.com` 403 (IP whitelist yok) · projede Trendyol kimlik bilgisi yok. Sırlar sohbette paylaşılmaz; `.env`'e kullanıcı yazar | INT-TY-01…03, SHP-02, kabul senaryosu | Kullanıcı |

**BLK-01 durumu (2026-11-13) — AÇIK, kısmen ilerledi:**

| Alt madde | Durum | Kanıt |
|---|---|---|
| Satıcı hesabı ve API kimlik bilgileri | Edinildi (muhtemelen çözüldü) | Kullanıcı onayıyla tek seferlik salt-okuma testi: canlı `apigw` ürün listesi 200, sipariş listesi 200. Hiçbir şey değiştirilmedi. Anahtarlar hiçbir dosyaya yazılmadı; kullanıcı test sonrası yenileyecek. Kalıcı giriş, kanal hesabı ekranı hazır olunca kullanıcı tarafından yapılacak |
| Stage ortamı ve IP whitelist | Doğrulanmadı | Stage denenmedi; 2026-10-29'da 403 (IP whitelist yok) |
| Resmî istek limiti | Doğrulanmadı | Canlı yanıtlarda rate-limit başlığı yoktu. `SYNC_RATE_TRENDYOL` varsayılanı (10:5) doğrulanmış limit değil; `SYNC_LIVE_CALLS` kapalı |

**BLK-01 resmî doküman okuması (2026-11-22, AÇIK):** stage IP yetkisi 0850 258 58 00 üzerinden satıcı bildirimiyle istenir; stage hesabı ve anahtarları canlıdan farklıdır (`stagepartner.trendyol.com`). IP listesi: yalnız IPv4, en çok 7. Dokümandaki statik IP cümlesi belirsiz, çağrı merkezine sorulmalı. İstek sınırı: uç başına 10 sn'de 50; grup sınırları Türkçe ve İngilizce sayfada çelişkili, hesap kademesine göre teyit gerekir.

BLK-01, stage/IP erişimi ve resmî limit doğrulanmadan kapatılmaz.

## 5. Riskler

Ciddiyet: **Kritik** (veri kaybı, tenant sızıntısı, ödeme) · **Yüksek** (güvenlik açığı veya geniş kesinti) · **Orta** (sınırlı etki) · **Düşük**.

### 5.1 Risk listesi

| ID | Ciddiyet | Risk | Bugünkü durum | Çözüm görevi |
|---|---|---|---|---|
| R-01 | Kritik | Aşama 2 migration'ı (`users.is_active`, `users.tenant_id` kaldırma) guard ve login/refresh hâlâ `users.is_active` okurken çalıştırılırsa tüm girişler bozulur veya pasif kullanıcı kontrolü kaybolur (`backend/src/auth/user-state.ts`, `auth.repository.ts`) | Aşama 2 uygulanmadı, `migrations-pending/`'de | USR-18 (önce kod, sonra migration, onay) |
| R-02 | Kritik | Prod öncesi otomatik yedek, PITR ve geri yükleme tatbikatı yok; şu an yalnızca elle çalışan betik var | Kısmen: dev yedeği ve geri yükleme doğrulandı, temiz kümede DB + nesne geri yükleme tatbikatı (#90, dev verisi), PITR provası sentetik veriyle (#85); zamanlayıcı ve prod altyapısı yok | OPS-03 |
| R-03 | Yüksek | Firma rolü yetki sınırları henüz uygulanmıyor: `user_company_roles` var ama companies modülü firma bazlı izin kontrol etmiyor; davet/kullanıcı yönetimi gelince yetki yükseltme yüzeyi açılır | USR-T7/T8 `main`'de (firma rolü kontrolü var); davet/kullanıcı yönetimi gelince yüzey açılır | USR-T14 |
| R-04 | Yüksek | (Kapandı: PR #10 merge `113b522`; dev'e deploy edildi `f010233`, 2026-10-30) Mağaza değiştirme sırasında Redis çökerse refresh zinciri yeniden kullanım (token hırsızlığı) olarak algılanabilir → sahte audit kaydı ve kullanıcının tüm cihazlardan çıkışı | Açık | INF-18 |
| R-05 | Yüksek | Redis tek nokta: rate limiting ve BFF oturumu fail-closed; Redis kesintisinde kimse giriş yapamaz | Dev'de tek Redis | INF-14 |
| R-06 | Yüksek | Tenant izolasyonu yeni modüllerde ihlal edilebilir (her yeni tablo/sorgu, kuyruk job'ları, ai-engine istekleri) | Prisma eklentisi + izin listesi testi var; job'lar için yok | INF-09, her modülde S testleri, USR-T14 |
| R-07 | Yüksek | Prod ağ/TLS/proxy yapılandırması yanlışsa IP rate limit herkesi birlikte engeller veya backend internete açılır | Prod yok | INF-17 |
| R-08 | Orta | BFF `forceRefresh` `stillNeeded` yarışı: eşzamanlı isteklerde oturum kapanabilir (kabul edilmiş, düzeltilmedi; MVP'den B'ye ertelendi, pilotta kabul edilmiş risk) | Açık | INF-19 |
| R-09 | Orta | Kayıtta `409` yanıtı e-postanın kayıtlı olduğunu sızdırır (kullanıcı numaralandırma) | Kapanıyor (INF-20 PR; merge sonrası kapanır) | INF-20 |
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
| R-24 | Orta | Playwright yalnızca `next dev` ile koşuyordu; prod benzeri tarayıcı testi yoktu | Kapandı (#89, `4aca721`): CI `integration` işi production frontend build üzerinde yerel TLS ile 23/23; HTTPS koruması değişmedi, test öncesi 308/426/HSTS doğrulanır. Kapsam dışı: backend production modu, gerçek sertifika zinciri, TLS SMTP | — |
| R-26 | Düşük (test) | Katalog yazımları SERIALIZABLE; tam e2e paralel koşarken nadiren bir ürün oluşturma 409 `CONCURRENT_UPDATE` alıyor ve aynı dosyadaki sonraki adımlar zincirleme düşüyor (2026-11-14'te 2 kez görüldü, tekrar koşuda temiz). Üretim davranışı doğru (istemci yeniden dener) | Kapandı (PR #60): `catalogWrite` serileştirme hatasında işlemi en çok 3 kez yeniden dener; iki ardışık tam e2e koşusu temiz | Test yardımcısında 409 için tek yeniden deneme veya katalog e2e dosyalarını sıralı koşma |
| R-25 | Orta (plan) | INT-01 (A) INF-13'e (B, KMS) bağlı; A'da yalnızca yerel anahtarla şifreleme mümkün. Prod öncesi KMS gerekir | Açık | INF-13 (B) |
| R-27 | Düşük | IMG-01: depodan silinemeyen nesneler sahipsiz kalır (anahtar loglanır); süpürücü iş yok. Prod depolamanın genel adresi `STORAGE_ENDPOINT`'ten farklı olursa CSP `img-src` ayrı değişken ister. Yeni tekil indeks `product_variants` yazmalarını oluşturulurken kilitler | Açık | Prod depolama seçimi |
| R-28 | Orta | IMG-01 son inceleme (`fe11e19`, engelleyici yok), 3 MEDIUM: işleme kapısı doluysa 503 gövde okunduktan sonra döner; yüklemede idempotency yok, zaman aşımı sonrası yeniden deneme çift görsel oluşturabilir; 6 eşzamanlı işleme ≈ 850 MB (tahmin, ölçülmedi), bellek sınırı tanımlı değil. LOW: BFF gövde okumasında ayrı zaman aşımı ve eşzamanlılık sınırı yok | Açık | Prod öncesi (OPS-06 yük testi) |

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
| 2026-11-27 | RPT-02 → DONE-MERGED; #106 merge `e87ae50`; dev deploy + variant_purchase_cost migration (kullanıcı onayıyla) | #103–#106 | smoke 46/46, verify.sql 2/2, `/health` ok | dev `e87ae50` |
| 2026-11-27 | #104, #103, #105 kullanıcı onayıyla merge edildi → RPT-02 DONE-NOT-DEPLOYED | #104 `91a2b5b`, #103 `3e85af3`, #105 `b6f2f2f` | main CI ✓ `b6f2f2f` | yok; migration uygulanmadı |
| 2026-11-27 | RPT-02 → DONE-PR: varyant alış maliyeti arayüzü + `GET /reports/stock` (değer, devir, stoksuz) ve `/reports/stock` sayfası; maliyet yalnız `products:write` firmalarında; bağımsız CRITICAL inceleme → ONAY (yalnız P3 notlar); #103 üstüne kurulu | [#105](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/105) | CI `61fd6a2`: unit 666/666, e2e 507/514 (7 skip), frontend 218/218, MinIO 17/17 | yok |
| 2026-11-25 | INT-TY-02b (Trendyol'a stok+fiyat elle gönderme, kullanıcı kararı A) → DONE-PR; mod CRITICAL'e yükseltildi, bağımsız inceleme 2 tur (1 BLOCKER + 3 HIGH düzeltildi, sonra engelleyici yok) | [#102](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/102) | CI `d7acbf1`: unit 651/651, e2e 492/499 (7 skip), frontend 216/216, MinIO 17/17, Playwright 23/23 | yok |
| 2026-11-25 | #99 → DONE-MERGED, dev deploy; INT-TY-02a canlı okuma tekrarı başarılı (iş `a5fc2425…`: 207 işlendi, 205 fiyat, 139 stok açılışı / 2459 adet, 1 atlandı), SYNC_LIVE_CALLS=false | #99 (merge `4570e31`), #100 (merge `89fb2c1`) | PR CI ✓; dev health ok | dev `4570e31` |
| 2026-11-24 | INT-TY-01a ek: eşleşmeyen Trendyol ürünlerini taslak ürün olarak içe aktarma → DONE-MERGED (dev deploy, canlı içe aktarma 203 taslak ürün) | #97 (merge `b96aa2d`) | PR CI ✓ | dev `b96aa2d` |
| 2026-11-24 | INT-TY-02a stok+fiyat okuma → DONE-MERGED; canlı okuma `SYNC_UNEXPECTED_ERROR` | #98 (merge `3f0c6dc`) | PR CI ✓ | dev `3f0c6dc` |
| 2026-11-25 | INT-TY-02a düzeltmesi: açılış kilidi `TENANT_VIOLATION`, maskeli beklenmeyen hata logu → PR (CRITICAL, bağımsız inceleme temiz) | [#99](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/99) | CI `a9a3a80`: unit 627/627, e2e 492/499 (7 skip), frontend 216/216, MinIO 17/17, Playwright 23/23 | yok |
| 2026-11-22 | OPS-03: prod aday A (DigitalOcean) teknik doğrulaması, `docs/BACKUP.md`; `setup-roles.sql` yönetilen PostgreSQL düzeltmesi (PR). Satın alma, kurulum, veri aktarımı yok; KVKK, anahtar sahipliği, bildirim adresi kararlaştırılmadı | #93 (merge `5b2bd7f`) | rol testi 9/9; Valkey 8/9 ile backend e2e 496 + 1 skip | yok |
| 2026-11-22 | R-24 kapandı (#89, merge `4aca721`); OPS-03 temiz ortam tatbikatı (#90, merge `d07c1fe`), OPS-03 IN PROGRESS | [#89](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/89), [#90](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/90) | #89: CI gerçek MinIO 6/6 + görsel API 11/11, Playwright 23/23; yerel ilk tur 22/23 (Redis zaman aşımı → 503), sonraki iki tur 23/23; inceleme engelleyicisiz. #90: 42 tablo eşit, 6 görsel, 13 nesne, `/health` ok, 34 sn; 5 negatif durum reddedildi; CRITICAL inceleme 3 tur (1 HIGH + MEDIUM bulgular kapandı, açık HIGH/MEDIUM yok). Linux tatbikatı koşulmadı | deploy gerektirmez (dev `ceee47e`) |
| 2026-11-22 | INF-12, IMG-01, USR-T13, USR-T15 → DONE-MERGED; OPS-03 dev dilimi merge edildi (IN PROGRESS); Next.js 16.4.6 | [#84](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/84), [#85](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/85), [#86](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/86), [#87](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/87) | unit 600/600, e2e 496 + 1 skip, fe 215/215, Playwright 23/23, smoke 46/46; IMG-01 üçüncü inceleme: engelleyici yok | dev `ceee47e` |
| 2026-11-22 | Dev deploy: USR-T9, T10, T11, T12, INF-19, INF-20 dev'de; INF-12 → DONE-NOT-DEPLOYED (depolama ayarı yok) | #73–#75, #77–#82 | dev smoke tümü geçti | dev `804886c` |
| 2026-11-16 | USR-T11 kalan dilim → DONE-PR: tenant kapsamlı kullanıcı detayı, liste/detayda global lastLoginAt; CRITICAL bağımsız incelemede bulgu yok | [#80](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/80) | kod 3f42e76, CI 43843739033: unit 571/571, e2e 471 geçti + 1 skip, frontend 206/206; build/lint yeşil. RED dd07458: 4 e2e başarısızlığı; yerel sözleşme 2 RED → 2 GREEN | yok; migration yok |
| 2026-11-15 | USR-T9 kalan B dilimi → DONE-PR; markalı davet HTML/düz metin şablonu. STANDARD öz-inceleme. Görev satırları tekilleştirildi: 142 toplam, 55 DONE-MERGED, 1 DONE-PR, 1 BLOCKED, 85 PLANNED; takvim yeniden hesaplanmadı | [#74](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/74) | kod `df54a82`, CI 43745748422: unit 572/572, e2e 467 geçti + 1 skip, frontend 198/198; build/lint yeşil. Yerel mail/davet 30/30, typecheck/lint temiz | yok; migration yok |
| 2026-10-28 | INF-01…08, USR-01, USR-02, DSH-01 → DONE-MERGED | #1–#5 | — | dev |
| 2026-10-29 | USR-T1…T6, USR-17 → DONE-PR | #6 | unit 184/184, e2e 165/165, fe 81/81 | yok (dev `eda38da`) |
| 2026-10-29 | Yol haritası oluşturuldu | — | — | — |
| 2026-10-29 | MVP Trendyol-only olarak sadeleştirildi (kullanıcı kararı): 18 görev B'ye, USR-T9…T15'ten 6 MVP dilimi, INT-TY-03'e yerel stok iadesi | #7 | — | — |
| 2026-10-29 | USR-T1…T6, USR-17 → DONE-NOT-DEPLOYED (merge `f1be19a`); USR-T7 → DONE-NOT-DEPLOYED (#8, `cc8b72a`); USR-T8 → DONE-NOT-DEPLOYED (#9, `95b5bdb`) | #6, #8, #9 | `main`: unit 211/211, e2e 173/173, fe 81/81, Playwright 13/13 (`next dev`) | yok (dev `eda38da`) |
| 2026-10-30 | USR-T9a (#12 `f9b5889`), USR-T10a (#15 `bc37227`), CAT-01 (#13 `aa02144`), INF-09 (#14 `6fef239`), CAT-02 (#16 `6824f6f`) → DONE-NOT-DEPLOYED | #12–#16 | `main` @ `6824f6f`: unit 283/283, e2e 305/306 (1 skip), fe 84/84 | yok (dev `eda38da`; CAT-01 migration dev DB'ye uygulanmadı) |
| 2026-10-30 | USR-T1…T8, USR-T9a, USR-T10a, USR-17, INF-09, INF-10, INF-18, CAT-01, CAT-02 → DONE-MERGED; CAT-01 migration dev DB'ye uygulandı | #6–#16 | yedek/geri yükleme ok, CAT-01 prova 16/16, smoke 30/30 | dev `f010233` |
| 2026-10-30 | USR-T11a → DONE-PR; OPS-08, USR-21 eklendi (kullanıcı kararı) | [#19](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/19) | CI: unit 283/283, e2e 318/319 (1 skip); yerel users e2e 13/13 ×3; kilitsiz mutasyonda eşzamanlılık testi başarısız (beklenen); bağımsız inceleme 2 tur, açık bulgu yok | yok |
| 2026-10-30 | USR-T11a → DONE-NOT-DEPLOYED (merge `8fc7ae3`) | [#19](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/19) | `main` @ `8fc7ae3`: unit 283/283, e2e 318/319 (1 skip), fe 84/84 | yok (dev `f010233`) |
| 2026-10-30 | USR-T11a → DONE-MERGED | [#19](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/19) | `main` CI (`8fc7ae3`): unit 283/283, e2e 318/319 (1 skip), fe 84/84; dev `/health` ok; smoke bildirildi, çıktı kaydedilmedi, doğrulanamadı | dev `8fc7ae3` (reflog, PID 2404 ve log ile doğrulandı; onay kaydı yok) |
| 2026-10-30 | USR-T12a → DONE-PR | [#22](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/22) | frontend unit 124/124, typecheck ok; CI ✓; bağımsız inceleme 2 tur, açık bulgu yok | yok |
| 2026-10-30 | USR-T12a → DONE-NOT-DEPLOYED (merge `f41c88e`, kullanıcı onayı) | [#22](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/22) | PR CI ✓ (`6fde946`) | yok (dev `8fc7ae3`) |
| 2026-10-30 | USR-T14 → DONE-PR | [#23](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/23) | CI (`42c82e6` sonrası): bkz. PR; ürün kodu değişmedi; bağımsız inceleme 2 tur, 2. turdaki Low bulgular (hata kodu sabitleme, rol geri yükleme) kapatıldı | yok |
| 2026-10-30 | USR-T12a, USR-T14 → DONE-MERGED (#23 merge `0437c16`, kullanıcı onayı) | [#22](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/22), [#23](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/23) | `main` CI (`0437c16`): fe 124/124, unit 283/283, e2e 331/332 (1 skip); dev smoke 43/44 + izolasyon yeniden kontrolü ok | dev `0437c16` (kullanıcı onayıyla) |
| 2026-11-11 | USR-T13a → DONE-PR (merge edilmedi) | [#25](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/25) | CI ✓: unit 283/283, e2e 331/332 (1 skip), fe 132/132 | yok |
| 2026-10-30 | USR-T13a → DONE-PR | [#25](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/25) | frontend unit 132/132, lint ok, typecheck ok; davranış testi USR-T15a (Playwright) | yok |
| 2026-11-11 | USR-T15a → DONE-PR | [#26](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/26) | Playwright (`next dev` :3100, backend :4100) ardışık 2 koşu 16/16, 16/16; frontend unit 132/132, lint ok, typecheck ok | yok |
| 2026-11-11 | USR-T16 → DONE-PR | [#28](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/28) | backend unit 283/283, e2e 331/332 (1 skip; 3. tam koşu, önceki 2 koşuda yük kaynaklı hook zaman aşımları, tekil yeniden koşu PASS), lint ok, build ok; frontend 132/132, lint ok, typecheck ok, `next build` ok; Playwright 16/16 ×2 | yok |
| 2026-11-11 | CAT-03 → DONE-PR | [#27](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/27) | yerel (izole `tm_e2e_cat`): unit 296/296, lint ok; e2e 347/350 (1 skip Mailpit, 2 flaky rate-limit/lockout — tek başına 54/54) | yok; migration dev DB'ye uygulanmadı |
| 2026-11-11 | CAT-05 → DONE-PR | [#29](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/29) | yerel (izole `tm_e2e_cat`): unit 315/315, lint ok; e2e 357/358 (1 skip Mailpit) | yok; migration dev DB'ye uygulanmadı |
| 2026-11-11 | CAT-04 → DONE-PR | [#30](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/30) | frontend unit 164/164, lint ok, typecheck ok; Playwright catalog-mobile 1/1 (izole :4100/:3100) | yok |
| 2026-11-11/12 | USR-T13a, USR-T15a, USR-T16, CAT-03, CAT-05, CAT-04 → DONE-NOT-DEPLOYED | #25 `719aa64`, #26 `eb6baf6`, #28 `8bd98db`, #27 `1db22ae`, #29 `28a03ae`, #30 `6a3eea0` | `main` CI ✓ her merge sonrası | yok; dev `0437c16` |
| 2026-11-12 | USR-T13a, USR-T15a, USR-T16, CAT-03, CAT-05, CAT-04 → DONE-MERGED (dev `5ac1401`, kullanıcı onayı) | #24–#30 | izole prova 11/11; smoke 43/44 + izolasyon yeniden kontrolü ok | dev `5ac1401` |
| 2026-11-12 | INT-01 → DONE-MERGED (merge `7b3c0b9`, dev `7b3c0b9`, kullanıcı onayı) | [#32](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/32) | CI: unit 333/333, e2e 369/370 (1 skip), fe 172/172; bağımsız CRITICAL inceleme 2 tur; dev smoke 43/44 + INT-01 kontrolü | dev `7b3c0b9` |
| 2026-11-12 | CAT-06 → DONE-MERGED (merge `8ee40bb`, dev `8ee40bb`, kullanıcı onayı) | [#34](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/34) | CI: unit 333/333, e2e 380/381 (1 skip), fe 172/172; dev smoke 43/44 + CAT-06 kontrolü | dev `8ee40bb` |
| 2026-11-13 | USR-19 → DONE-MERGED (merge `736cb40`, dev `736cb40`, kullanıcı onayı) | [#36](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/36) | `main` CI ✓; dev USR-19 smoke ok (doğrulama, sıfırlama, eski şifre 401 / yeni 200) | dev `736cb40` |
| 2026-11-13 | INT-02 → DONE-PR (merge edilmedi) | [#38](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/38) | yerel (izole `tm_e2e_sync`): unit 348/348, e2e 411/412 (1 skip Mailpit), lint ok, build ok; bağımsız CRITICAL inceleme 2 tur → APPROVE | yok; migration dev DB'ye uygulanmadı |
| 2026-11-13 | INT-02 → DONE-MERGED (merge `70bae17`, dev `70bae17`, kullanıcı onayı) | [#38](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/38) | CI ✓; izole prova ok; dev smoke 22/22 + USR-19 kontrolü | dev `70bae17` |
| 2026-11-13 | INT-03 → DONE-PR (merge edilmedi) | [#40](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/40) | backend: bağlantı testi e2e 6/6 (sahte Trendyol sunucusu), sync e2e 21/21; frontend unit 177/177, lint ok, typecheck ok. `next build` ve Playwright yerelde koşulmadı (bellek); CI'ye bırakıldı | yok; migration yok |
| 2026-11-14 | INV-04 → DONE-MERGED (merge `cb07e60`, dev `cb07e60`, kullanıcı onayı; API, Sürüm B öne alındı) | [#71](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/71) | unit 569/569; izole e2e 467/468 (1 skip Mailpit); PR CI ✓; dev smoke 32/32 | dev `cb07e60` |
| 2026-11-14 | IMP-04 → DONE-MERGED (merge `dc64348`, dev `dc64348`, kullanıcı onayı; Sürüm B, öne alındı) | [#69](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/69) | unit 569/569; izole e2e 464/465 (1 skip Mailpit); frontend 198/198; PR CI ✓; dev smoke 32/32 | dev `dc64348` |
| 2026-11-14 | DSH-02 → DONE-MERGED (merge `3f45f98`, dev `4c029c0`, kullanıcı onayı; Sürüm B görevi öne alındı) | [#64](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/64) | unit 566/566; izole e2e 461/462 (1 skip Mailpit); frontend 196/196; PR CI ✓; dev smoke 32/32; arayüz kontrolü | dev `4c029c0` |
| 2026-11-14 | USR-19b → DONE-MERGED (merge `cd83fea`, dev `cd83fea`, kullanıcı onayı) | [#62](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/62) | frontend 195/195; PR CI ✓; uçtan uca Mailpit akışı | dev `cd83fea` |
| 2026-11-14 | OPS-01 → DONE-MERGED (`ce85f36`, PR olmadan doğrudan push — süreç sapması; dev `ce85f36`) | — | unit 563/563; izole e2e 458/459; main CI ✓; dev smoke 32/32 | dev `ce85f36` |
| 2026-11-14 | IMP-01 → DONE-MERGED (merge `0568b56`, dev `0568b56`, kullanıcı onayı) | [#57](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/57) | unit 543/543; izole e2e 455/456 (1 skip Mailpit); frontend 188/188; PR CI ✓; dev smoke 32/32; arayüz uçtan uca | dev `0568b56` |
| 2026-11-14 | INV-03 → DONE-MERGED (merge `ad4de17`, dev `ad4de17`, kullanıcı onayı) | [#55](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/55) | unit 536/536; izole e2e 450/451 (1 skip Mailpit); frontend 184/184; prova 12/12; PR CI ✓; dev smoke 32/32; arayüz kontrolü | dev `ad4de17` |
| 2026-11-14 | RPT-01 → DONE-MERGED (merge `633f250`, dev `633f250`, kullanıcı onayı) | [#53](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/53) | unit 536/536; izole e2e 446/447 (1 skip Mailpit); frontend 183/183; PR CI ✓; dev smoke 32/32; arayüz kontrolü | dev `633f250` |
| 2026-11-14 | INV-02 → DONE-MERGED (merge `9d4eb11`, dev `9d4eb11`, kullanıcı onayı) | [#51](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/51) | PR CI ✓; prova 14/14; dev smoke 32/32 | dev `9d4eb11` |
| 2026-11-14 | INV-02 → DONE-PR | [#51](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/51) | unit 531/531; izole e2e 442/443 (1 skip Mailpit); migration 4/4; prova 14/14; bağımsız CRITICAL inceleme 2 tur → APPROVE (kalan Düşük: ship dalında kilit sırası 409 ile güvenli; app.tenant_id tm_app tarafından ayarlanabilir, SECURITY.md) | yok; migration dev DB'ye uygulanmadı |
| 2026-11-14 | ORD-03 → DONE-MERGED (merge `75ce1de`, dev `75ce1de`, kullanıcı onayı) | [#49](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/49) | frontend unit 182/182, lint ok, typecheck ok; PR CI ✓ (2. koşu); dev smoke 26/26; arayüz masaüstü+mobil, konsol hatası yok | dev `75ce1de` |
| 2026-11-14 | ORD-02 → DONE-MERGED (merge `9062bb6`, dev `9062bb6`, kullanıcı onayı) | [#47](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/47) | unit 531/531 (169 geçiş hücresi); izole e2e 432/433 (1 skip Mailpit); PR CI ✓; dev smoke 26/26 | dev `9062bb6` |
| 2026-11-14 | OPS-08 → DONE-MERGED (merge `63bbb94`) | [#45](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/45) | dev yedeğiyle 2 koşu: bekleyen yok → 2/2 çıkış 0; INV-01 bekliyorken 14/14 | betik; INV-01 deploy provasında kullanıldı |
| 2026-11-14 | INV-01 → DONE-MERGED (merge `458ee82`, dev `458ee82`, kullanıcı onayı) | [#44](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/44) | unit 358/358; izole e2e 425/426 (1 skip Mailpit); migration testi 4/4 (tm_app ile kilit beklemesi doğrulanmış eşzamanlılık); bağımsız CRITICAL inceleme 2 tur → APPROVE; prova 14/14; dev smoke 21/21 | dev `458ee82` |
| 2026-11-14 | ORD-01 → DONE-MERGED (merge `93c03b1`, dev `93c03b1`, kullanıcı onayı) | [#42](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/42) | PR CI ✓; izole prova ok; dev smoke 21/21 | dev `93c03b1` |
| 2026-11-14 | ORD-01 → DONE-PR | [#42](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/42) | yerel: unit 353/353; izole `tm_e2e_orders` e2e 421/422 (1 skip Mailpit); migration testi 3/3; lint ok, build ok; bağımsız CRITICAL inceleme 2 tur → APPROVE (kalan 2 Düşük: içe alımda tutar sapma uyarısı, `channel_discount_total` negatif test vakası) | yok; migration dev DB'ye uygulanmadı |
| 2026-11-14 | INT-03 → DONE-MERGED (merge `65fcf85`, dev `65fcf85`, kullanıcı onayı) | [#40](https://github.com/sarikayadem1983-glitch/E-ticaret-Merkezi-2.0/pull/40) | PR CI ✓; dev smoke 21/21 | dev `65fcf85` |
| 2026-11-15 | IMP-01 ek: .xlsx içe aktarma (tarayıcıda exceljs 4.4.0 → mevcut CSV doğrulaması; kullanıcı kararı 2026-11-15) → PR | (bu PR) | yerel: frontend unit 206/206 (8 yeni), lint ok (1 eski uyarı), typecheck ok | yok |
