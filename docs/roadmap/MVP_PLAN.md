# MVP Planı (Sürüm A — Trendyol-only)

> **Onay durumu:** Yalnızca kullanıcı yönetimi planındaki görevler (`USR-T1`…`USR-T16`, plan: `docs/superpowers/plans/2026-10-28-user-management.md`) ve merge edilmiş işler (INF-01…08, USR-01, USR-02, DSH-01) **onaylı plandır**. MVP'nin Trendyol-only kapsamı ve ertelenecek görev listesi **kullanıcı kararıdır** (2026-10-29). USR-T9…T15'in MVP dilimlerine bölünmesi, diğer görevler, tahminler ve tarihler **öneridir, kullanıcı onayı beklemektedir**. Her görevin kaynağı `TASK_REGISTER.md`'deki "Kaynak" sütunundadır.

## 1. Amaç ve kapsam

Amaç: pilot satıcının ürünlerini tek yerden yönetip **Trendyol**'da satabildiği; siparişlerini, stoklarını, Trendyol iptal ve iadelerini işleyebildiği ilk çalışan e-ticaret operasyon platformu. Çıkış kriterleri: `RELEASE_PLAN.md`.

**Kapsam:** 57 görev — 20 tamamlandı (11 `DONE-MERGED`, 9 `DONE-NOT-DEPLOYED`), 37 kalan.
Kalan 37 = kullanıcının listelediği 33 görev − USR-T7, USR-T8 (merge edildi, PR #8/#9) + kullanıcı yönetimi planından ayrılan 6 MVP dilimi (USR-T9a, T10a, T11a, T12a, T13a, T15a).

**Kapsam dışı (Sürüm B'ye taşındı):** Hepsiburada (INT-HB-01…03), genel iptal/iade iş akışı ve iade UI (SHP-01; Trendyol iptal/iade senkronu MVP'de INT-TY-03 içinde), webhook alıcısı (INT-04; Trendyol siparişleri polling ile çekilir), asenkron içe aktarma (IMP-02; MVP'de IMP-01 senkron, satır sınırı ile), görsel türev/uygunluk (IMG-02), KPI dashboard (DSH-02), müşteri modeli ve UI (CRM-01, CRM-02), stok raporları (RPT-02), BFF `forceRefresh` yarışı (INF-19), USR-T9…T13, T15'in kalan kısımları. Ayrıca e-Fatura, abonelik/ödeme, diğer pazaryerleri, kârlılık, hakediş, prod ortamı, AI.

## 2. Kalan MVP görevleri (39)

| ID | Görev | Tahmin (iş günü) | Mod | Kaynak |
|---|---|---|---|---|
| INF-09 | Kuyruk altyapısı (BullMQ) | 3 | CRITICAL | Öneri |
| INF-10 | CI pipeline | 2 | STANDARD | Öneri |
| INF-12 | Nesne depolama (S3/MinIO) | 2 | STANDARD | Öneri |
| INF-18 | Mağaza değiştirmede Redis hatası düzeltmesi | 2 | CRITICAL | Öneri |
| USR-T9a | Mail modülü çekirdeği + Mailpit | 1,5 | STANDARD | Onaylı plan — MVP dilimi |
| USR-T10a | Davet servisi çekirdeği | 3 | CRITICAL | Onaylı plan — MVP dilimi |
| USR-T11a | Users modülü çekirdeği (liste, erişim, pasife al/aktifleştir) | 2,5 | CRITICAL | Onaylı plan — MVP dilimi |
| USR-T12a | BFF route'ları çekirdeği | 0,5 | CRITICAL | Onaylı plan — MVP dilimi |
| USR-T13a | Kullanıcılar sayfası + davet kabul sayfası (çekirdek) | 2 | STANDARD | Onaylı plan — MVP dilimi |
| USR-T14 | Yetki yükseltme ve tenant izolasyonu test paketi | 2 | CRITICAL | Onaylı plan |
| USR-T15a | Playwright çekirdek akışlar | 1 | STANDARD | Onaylı plan — MVP dilimi |
| USR-T16 | Tam doğrulama ve PR | 1 | STANDARD | Onaylı plan |
| USR-19 | Şifre sıfırlama ve e-posta doğrulama | 3 | CRITICAL | Öneri |
| CAT-01 | Katalog şeması | 3 | CRITICAL | Öneri |
| CAT-02 | Ürün CRUD API | 3 | STANDARD | Öneri |
| CAT-03 | Varyant ve özellik yönetimi | 4 | STANDARD | Öneri |
| CAT-04 | Katalog UI | 4 | STANDARD | Öneri |
| CAT-05 | Fiyat yönetimi | 2 | STANDARD | Öneri |
| CAT-06 | Kanal kategori/özellik eşleme | 4 | STANDARD | Öneri |
| IMP-01 | Excel/CSV şablonu, doğrulama, dry-run | 3 | STANDARD | Öneri |
| IMG-01 | Görsel yükleme, sıralama, bağlama | 3 | STANDARD | Öneri |
| INT-01 | `ChannelAdapter`, kanal hesabı, kimlik bilgisi şifreleme | 4 | CRITICAL | Öneri |
| INT-02 | Senkron motoru | 5 | CRITICAL | Öneri |
| INT-03 | Entegrasyon yönetim UI | 3 | STANDARD | Öneri |
| INT-TY-01 | Trendyol bağlantısı + ürün oluşturma/güncelleme | 5 | STANDARD | Öneri |
| INT-TY-02 | Trendyol stok ve fiyat senkronu | 3 | STANDARD | Öneri |
| INT-TY-03 | Trendyol sipariş, kargo, iptal/iade senkronu + yerel stok iadesi | 6 (5 → 6) | STANDARD | Öneri |
| ORD-01 | Sipariş şeması | 2 | CRITICAL | Öneri |
| ORD-02 | Sipariş API ve durum makinesi | 4 | STANDARD | Öneri |
| ORD-03 | Sipariş UI | 3 | STANDARD | Öneri |
| INV-01 | Depo ve stok şeması | 3 | CRITICAL | Öneri |
| INV-02 | Rezervasyon ve düşüm | 4 | CRITICAL | Öneri |
| INV-03 | Stok UI ve düşük stok uyarısı | 2 | STANDARD | Öneri |
| SHP-02 | Pazaryeri kargo etiketi ve takip no | 3 | STANDARD | Öneri |
| RPT-01 | Satış raporları | 3 | STANDARD | Öneri |
| OPS-01 | Yapılandırılmış log + hata izleme | 2 | STANDARD | Öneri |
| OPS-03 | Otomatik yedek ve geri yükleme tatbikatı | 3 | CRITICAL | Öneri |
| **Toplam** | **37 görev** | **106,5** | | |

Toplamın dökümü: kullanıcının listelediği 33 görev 99 iş günü + 6 MVP dilimi 10,5 iş günü + INT-TY-03'e eklenen yerel stok iadesi 1 iş günü = 110,5; merge edilen USR-T7 ve USR-T8 (2 + 2) düşülünce **106,5 iş günü**.

## 3. İş yükü ve takvim (ayrı ayrı)

**İş yükü (effort):** 106,5 iş günü toplam; 2026-10-30 itibarıyla 27 görev tamam, **kalan 89 iş günü**. Bu, görev tahminlerinin toplamıdır; takvim süresi değildir.

**Takvim süresi (calendar):**

| Adım | Değer |
|---|---|
| M0 (başlangıç kapısı) | PR #6, #8, #9 kullanıcı onayıyla merge edildi (2026-10-29). Dev deploy ayrı onay bekler |
| Başlangıç | 2026-11-02 (M0'dan sonraki pazartesi) |
| Yeniden hesap (2026-10-30) | kalan 89 / 2 ≈ 44,5 iş günü, %15 tampon → ≈ 52 iş günü → M3 2027-01-13 |
| İlk hesap: 2 paralel akış | 106,5 / 2 ≈ 53,3 iş günü (kritik yol 23 iş günü olduğundan süreyi kapasite belirler) |
| %15 tampon (onay gecikmesi dahil: her onay kapısı 0,5–1 iş günü; migration, merge, deploy) | ≈ 62 iş günü → 2027-01-27 |
| Resmî tatil | 2027-01-01 düşüldü (aralıkta başka resmî tatil yok) |
| Kabul fazı | 5 iş günü (uçtan uca stage senaryosu, kullanıcı kabulü) |
| **Tahmini hedef** | **2027-01-20** (ilk hesap 2027-02-03) |

> **2027-01-20 tahmini bir hedeftir, taahhüt edilmiş teslim tarihi değildir.** Varsayımlar: M0 merge'leri 2026-10-29'da tamamlandı; Trendyol stage erişimi en geç INT-TY-01 başlangıcına (≈ 2026-12-14) kadar gelir; 2 akış kesintisiz yürür; onay kapıları ortalama 0,5–1 iş günü sürer. Bunlardan biri tutmazsa tarih kayar. İlk 3–4 modülden sonra tahminler yeniden kalibre edilir.

## 4. USR-T9…T13, T15: ayrıntılı değerlendirme

Soru: ilk müşteri ekibini nasıl ekler, ve hangi parça ertelenebilir?

**Seçenekler:**

1. **Owner'ın geçici şifreyle kullanıcı oluşturması — önerilmez.** Kullanıcı kimliği global (spec, Yaklaşım A): bir mağazanın owner'ı başka mağazalarda da kullanılabilecek bir hesabın şifresini belirlemiş olur. Spec bunu açıkça yasaklar ("Bir mağazanın, başka mağazadaki üyeliği veya kullanıcının şifresini/adını değiştirebilmesi"). E-posta zaten kayıtlıysa ya hesap varlığı sızar ya da hesap sahibinin rızası olmadan üyelik eklenir. Ayrıca "ilk girişte şifre değiştir" bayrağı için yeni migration, e-posta doğrulanmamış hesap ve şifrenin yan kanaldan iletilmesi gerekir. Davet çekirdeğinden ucuz değildir ve güvenlik modelini bozar.
2. **Seed/admin betiği — yalnızca acil durum.** Operatörün DB erişimiyle üyelik eklemesi tenant izolasyonunu ve audit'i ürün dışında atlar; her pilot için insan müdahalesi gerektirir. Ürün yolu olarak önerilmez; görev olarak eklenmedi.
3. **Davet çekirdeği (önerilen).** USR-19 (şifre sıfırlama, MVP'de) zaten mail modülünü gerektirir; mail varken davet, spec'in güvenlik garantilerini (hash'li tek kullanımlık token, rıza, e-posta sahipliği) koruyan en ucuz yoldur.

| Görev | MVP'de gereken (dilim) | Ertelenen (B) | Gerekçe |
|---|---|---|---|
| USR-T9 Mail | **T9a** (1,5): `MailService`, SMTP/log transport, prod'da TLS zorunlu ve `log` yasak, Mailpit, URL/token loglanmaz | Davet şablonu (0,5) — T10a ile birlikte yazılırsa T9a içinde kalabilir | USR-19 şifre sıfırlama T9'a bağlı; T9 tamamen ertelenemez |
| USR-T10 Davet | **T10a** (3): oluştur (Admin / firma rolleri, `canGrant`), iptal, yeniden gönder (yeni token), lookup, kabul (yeni hesap veya mevcut hesap + şifre); hash'li token, tek transaction, eşzamanlı kabul bir kez, kabulde davet edenin yetkisini yeniden doğrulama, başka tenant'taki e-postayı sızdırmama | `accept-as-current` (oturum açıkken kabul), pasif üyeliği davetle değiştirme (MVP'de `409`), `status` filtreli liste, resend hız sınırlarının ince ayarı (1) | Ekip eklemenin tek güvenli yolu. Güvenlik testleri dilimde kalır, kesilmez |
| USR-T11 Users | **T11a** (2,5): `GET /users`, `PUT /users/:id/access`, `deactivate` / `activate`, audit | `GET /users/:id` detay, `lastLoginAt` (0,5) | Pasife alma T6'nın anında oturum iptaline bağlıdır: işten ayrılan personelin erişimini kesmenin tek yolu. MVP'de **zorunlu**. `PUT access` USR-T8'in "rol kaldırınca eski token `TOKEN_STALE`" senaryosunun ürün yoludur |
| USR-T12 BFF | **T12a** (0,5): users + invitations allowlist, `PUT`, oturumsuz lookup/accept route'ları, `Referrer-Policy: no-referrer` | Resend/liste route'ları, `accept-as-current` dalı (0,5) | Token'ın Referer ile sızmaması MVP'de de gerekir |
| USR-T13 UI | **T13a** (2): masaüstü kullanıcı tablosu, davet diyaloğu + erişim düzenleyici, pasife al/aktifleştir; kabul sayfası `loading`, `invalid`, `newAccount`, `existingAccount`, `done` | Bekleyen davetler paneli, `signedInSameEmail` / `signedInOtherEmail`, "mağazaya geç" düğmesi, mobil kart görünümü (1) | Owner'ın API'yi elle çağırması beklenemez |
| USR-T15 Playwright | **T15a** (1): davet → davetli yalnızca A firmasını görür; iptal edilen bağlantı; pasife alınan kullanıcı sonraki işlemde çıkar | Başka mağazadaki mevcut kullanıcının kabul + isteğe bağlı mağaza değiştirme, açık sekmede rol değişikliği, mobil (1) | Mağaza değiştirme T5 testleriyle zaten kapsanıyor; çok mağazalı davet ve mobil pilot için kritik değil |

**Etkisi:** MVP'ye 10,5 iş günü eklenir; orijinal satırlarda 4,5 iş günü B'de kalır. USR-T14 MVP dilimlerinin tüm uçlarını kapsar. USR-T16 MVP dilimleri için PR'ı kapatır; kalan kısımlar B'de ayrı PR.

**Bilinen risk:** Plan T8'in bir testi `PUT /users/:id/access` (T11) kullanır. T8 bu adımı repository fixture'ıyla kurar; ürün yolu T11a ile gelir. Pasif üyeliği olan bir e-postaya yeniden davet MVP'de `409` döner; yönetici T11a `activate` ile açar.

## 5. İptal / iade kapsamı (doğrulama)

**Doğrulanan (developers.trendyol.com doküman dizini ve sayfaları, 2026-10-29):**
- Satıcı tarafı iptal: "Tedarik Edememe Bildirimi" (`cancelOrderPackageItem`) uç noktası var.
- İade (claim): `getClaims` (iade listesi), `approveClaimLineItems` (onay), `createClaimIssue` + `getClaimIssueReasons` (ret talebi), `getClaimItemAudits`, `createClaim` (satıcı iade talebi) var. Onay/ret yalnızca `WaitingInAction` durumundaki kalemlerde yapılır.
- Stage (test) ortamı: test siparişi oluşturma, test siparişi statü güncelleme ve test iadesini `WaitingInAction`'a çekme uçları var.
- Stage IP whitelist: API ile yönetilir (yalnızca IPv4, aynı anda en fazla 7 IP, günde 7 ekleme, IP'lerin `expiresAt` süresi var).

**Varsayılan (doğrulanmadı):**
- Müşteri iptallerinin `getShipmentPackages` yanıtında `Cancelled` durumuyla geldiği (Trendyol iade sayfası bunu söylemiyor).
- İade onayının stok üzerinde Trendyol tarafında bir etkisi olmadığı; yerel stoğa iadenin bizim sorumluluğumuz olduğu.
- Onaylanmayan claim'lerin süre aşımında otomatik onaylanma kuralları (dokümanda yok).
- Stage ortam taban URL'i ve erişim başvuru süreci; bizim hesabımıza stage erişiminin verileceği.

**Karar:** INT-TY-03 eskiden "iptal/iade" diyordu ama yerel stok iadesini tanımlamıyordu; SHP-01 ise B'ye taşındı. Boşluk kalmaması için yerel stok iadesi **INT-TY-03 kabul kriterlerine eklendi** (+1 iş günü, bağımlılık INV-02). Kapsam: `Cancelled` ve `unsupplied` → rezervasyonu/düşümü geri alan stok hareketi; claim çekme, onay ve ret; onaylanan iade kalemi için tek seferlik (idempotent) stok girişi. Genel çok kanallı iade iş akışı, manuel iade ve iade UI SHP-01'de (B) kalır. Ayrı bir SHP-01 dilimi gerekmez.

## 6. Fazlar (2 akış)

| Faz | Akış 1 | Akış 2 | İş günü | Tahmini bitiş |
|---|---|---|---|---|
| 0 — M0 | PR #6, #8, #9 merge (tamam); dev deploy onay bekliyor | | — | 2026-10-29 |
| 1 — M1 | CAT-01 → CAT-02 → CAT-03 → CAT-05 → INF-12 → IMG-01 (17) | INF-18 → INF-10 → USR-T9a → USR-T10a → USR-T11a → INF-09 (14) | 31 | 2026-11-25 |
| 2 — M2 | INT-01 → CAT-06 → INT-02 → CAT-04 → IMP-01 (20) | USR-T12a → USR-T13a → USR-T14 → USR-T15a → USR-T16 → USR-19 → ORD-01 → INV-01 → ORD-02 (18,5) | 38,5 | 2026-12-25 |
| 3 — M3 | INT-TY-01 → INT-TY-03 → INT-TY-02 → SHP-02 (17) | INV-02 → INT-03 → ORD-03 → INV-03 → RPT-01 → OPS-01 → OPS-03 (20) | 37 | 2027-01-27 |
| 4 — A | Kabul: uçtan uca stage senaryosu, izolasyon paketleri, yedek tatbikatı, kullanıcı kabulü | | 5 | **2027-02-03 (tahmini hedef)** |

CAT-01/CAT-02 akış 1'de yürür; USR-T8 `main`'de olduğundan CAT-02'nin firma izin kontrolü doğrudan bağlanır. CAT-03 ve CAT-06 paraleldir (CAT-06 CAT-02 + INT-01'i bekler). INT-01'in USR-T8 önkoşulu karşılandı.

## 7. MVP riskleri

- **Ana dış kapı: Trendyol API ve stage erişimi.** Satıcı hesabı, API anahtarı/secret, satıcı ID ve stage IP whitelist'i gerekli. Stage taban URL'i ve başvuru süreci doğrulanmadı; whitelist yalnızca IPv4 ve süreli. Erişim INT-TY-01 başlangıcına (≈ 2026-12-14) kadar gelmezse INT-TY-01…03 ve SHP-02 `BLOCKED` olur ve hedef kayar. Kullanıcı başvuruyu M1'den önce başlatmalı.
- `main` dev'e deploy edilmedi; dev'de elle doğrulama deploy onayını bekler.
- INT-01 INF-13'e (B, KMS) bağlı: A'da yerel anahtarla şifreleme; prod öncesi KMS gerekir (R-25).
- Playwright prod modunda (`next start`) koşmuyor; kabulde yerel TLS ile koşturulacak (R-24).
- Her yeni şema görevi (CAT-01, ORD-01, INV-01, INT-01) ayrı migration onayı gerektirir (G3).
- INF-19 (BFF `forceRefresh` yarışı) B'ye ertelendi: pilotta eşzamanlı isteklerde nadiren oturum kapanabilir (kabul edilmiş risk, prod öncesi zorunlu).
- IMG-02 ertelendi: Trendyol görselleri URL'den çeker; INT-TY-01 kalıcı HTTPS URL vermelidir (INF-12 imzalı URL'lerinin süresi dolmamalı).
- IMP-02 ertelendi: büyük Excel dosyaları MVP'de senkron ve satır sınırlı işlenir.
