# Sürüm Planı

> **Onay durumu:** Yalnızca kullanıcı yönetimi planındaki görevler (`USR-T1`…`USR-T16`, plan: `docs/superpowers/plans/2026-10-28-user-management.md`) ve merge edilmiş işler (INF-01…08, USR-01, USR-02, DSH-01) **onaylı plandır**. Diğer tüm modüller, görevler, tahminler ve tarihler **öneridir, kullanıcı onayı beklemektedir**. Her görevin kaynağı `TASK_REGISTER.md`'deki "Kaynak" sütunundadır.

Görev listeleri `TASK_REGISTER.md`'deki "Sürüm" sütunundan türetilir. Tahmin varsayımları: `MASTER_ROADMAP.md` §6. Sürüm başına tam görev tabloları (durum, tahmin, mod, kaynak): `TASK_REGISTER.md` → "Sürümlere göre görev listeleri".

## Sürüm A — MVP: ilk çalışan e-ticaret operasyon platformu

**Hedef kullanıcı:** pilot satıcılar (ücretsiz/erken erişim), kontrollü ortam.

**Zorunlu özellikler:** çoklu tenant ve firma başına rol, davetle kullanıcı ekleme, şifre sıfırlama; ürün kataloğu (varyant, fiyat, görsel, Excel/CSV içe aktarma); Trendyol ve Hepsiburada'da listeleme, stok/fiyat senkronu, sipariş içeri alma; sipariş ekranları, stok rezervasyonu ve düşümü, iptal/iade, pazaryeri kargo etiketi; müşteri listesi; temel satış/stok raporları ve KPI dashboard; hata izleme, otomatik yedek.

**Görevler:** 69 (18 tamamlandı, 51 kalan). Kalan: INF-09, INF-10, INF-12, INF-18, INF-19 · USR-T7…USR-T16, USR-19 · DSH-02 · CAT-01…CAT-06 · IMP-01, IMP-02 · IMG-01, IMG-02 · INT-01…INT-04 · INT-TY-01…03 · INT-HB-01…03 · ORD-01…ORD-03 · INV-01…INV-03 · SHP-01, SHP-02 · CRM-01, CRM-02 · RPT-01, RPT-02 · OPS-01, OPS-03. Tahmin: 149 iş günü.

**Çıkış kriterleri:**
1. Tüm A görevleri `DONE-MERGED` ve dev'e deploy edilmiş; CI yeşil.
2. Sandbox/test hesabında uçtan uca senaryo: ürün oluştur → Trendyol ve Hepsiburada'da listele → sipariş gelir → stok düşer → etiket → iade → stok geri gelir.
3. USR-T14 yetki yükseltme/tenant izolasyonu paketi ve her modülün izolasyon testleri PASS.
4. INF-18 ve INF-19 kapalı; kritik/yüksek açık risk yok (`PROJECT_STATUS.md` §5).
5. Yedekten geri yükleme tatbikatı (OPS-03) başarılı.
6. Kullanıcının pilot kabulü.

## Sürüm B — Ticari SaaS: ücretli müşteriye satılabilir, güvenli, yönetilebilir

**Zorunlu özellikler:** abonelik planları, kartla ödeme, limitler; e-Arşiv/e-Fatura kesimi, iptal/iade faturası; kârlılık ve gider hesaplama; hakediş ve mutabakat; Amazon TR ve n11; manuel sipariş, çoklu depo, tedarikçi; kampanya yönetimi; anlaşmalı kargo; dışa aktarma ve zamanlanmış rapor; bildirim merkezi; 2FA; Aşama 2 migration; staging + prod deploy, Redis HA, secret yönetimi, TLS/ağ, CAPTCHA, nonce CSP, enumeration düzeltmesi; izleme/alarm, süper admin paneli, KVKK süreçleri, yük testi, bağımsız güvenlik denetimi.

**Görevler:** 43 — INF-11, INF-13…INF-17, INF-20 · USR-18, USR-20 · DSH-03 · IMP-03, IMP-04 · INT-AMZ-01…03, INT-N11-01…03 · ORD-04 · INV-04 · SHP-03 · EFT-01…EFT-04 · CRM-03 · CMP-01 · PRF-01…03 · STL-01…03 · RPT-03 · SUB-01…04 · OPS-02, OPS-04…OPS-07. Tahmin: 149 iş günü.

**Çıkış kriterleri:**
1. `SECURITY.md` §4 "Canlıya çıkış öncesi kontrol listesi" tamamen işaretli.
2. `PROJECT_STATUS.md` §5.2 "Canlıdan önce mutlaka" listesi kapalı.
3. OPS-07 denetiminde kritik/yüksek bulgu yok.
4. OPS-06 yük testi hedefleri karşılandı; alarm ve yedek tatbikatı prod benzeri ortamda başarılı.
5. Gerçek ödeme ve gerçek e-Fatura test ortamında uçtan uca; KVKK metinleri yayında.
6. Staging'de 2 hafta kesintisiz pilot; kullanıcının satış onayı.

## Sürüm C — Gelişmiş SaaS

**Zorunlu özellikler:** `ai-engine` çekirdeği; AI ürün içeriği, görsel özellik çıkarma, toplu zenginleştirme, arka plan temizleme; AI asistan; kural tabanlı otomasyonlar; satış tahmini; reklam harcaması ve AI kampanya optimizasyonu; gelişmiş analitik; muhasebe dışa aktarımı; Pazarama, ÇiçekSepeti, Temu.

**Görevler:** 21 — AIU-01…03 · IMG-03 · INT-PZR-01…03, INT-CS-01…03, INT-TEMU-01…03 · EFT-05 · CMP-02, CMP-03 · RPT-04 · AIE-01…04. Tahmin: 87 iş günü.

**Çıkış kriterleri:**
1. `ai-engine`'in diğer modül tablolarına erişmediği mimari testle kanıtlı; AI çıktıları onaysız veri değiştirmiyor.
2. AI asistan izolasyon testleri (başka tenant/yetkisiz veri) PASS; tenant başına maliyet kotası çalışıyor.
3. Yeni pazaryerleri ortak kriterleri karşılıyor.

## Takvim

Varsayım: başlangıç **2026-11-02** (PR #6 merge onayı o hafta), 2 paralel akış, %15 tampon, resmî tatiller (1 Ocak, Ramazan Bayramı ~9–11 Mart 2027, 23 Nisan, 1 Mayıs, Kurban Bayramı ~16–19 Mayıs 2027, 15 Temmuz, 30 Ağustos, 29 Ekim) düşülmüş. Dış erişim gecikirse ilgili kilometre taşı kayar.

| Kilometre taşı | Hedef | İçerik |
|---|---|---|
| M0 | 2026-11-06 | PR #6 incelendi, merge + dev deploy (kullanıcı onayıyla) |
| M1 | 2026-11-27 | Kullanıcı yönetimi tamam (USR-T7…T16), INF-09/10/18/19, CAT-01/02 |
| M2 | 2026-12-25 | Katalog, görsel, içe aktarma, entegrasyon çerçevesi, sipariş/stok çekirdeği |
| M3 | 2027-02-05 | Trendyol uçtan uca; Hepsiburada listeleme |
| M4 | 2027-03-05 | Hepsiburada tamam, iade/kargo, raporlar, dashboard, yedek tatbikatı |
| **A — MVP** | **2027-03-19** | Kabul testi ve pilot başlangıcı |
| M5 | 2027-05-14 | Abonelik/ödeme, e-Fatura, staging/prod altyapısı |
| M6 | 2027-07-02 | Amazon TR, n11, kârlılık, hakediş, KVKK, süper admin |
| **B — Ticari** | **2027-07-30** | Güvenlik denetimi kapandı, satışa açılış |
| **C — Gelişmiş** | **2027-10-15** | AI, kampanya optimizasyonu, gelişmiş analitik, 7 pazaryeri |

**Önceden başlatılması gereken dış işler (MVP sırasında):** Trendyol ve Hepsiburada satıcı/sandbox erişimi (M1'den önce); e-Fatura entegratör sözleşmesi ve ödeme sağlayıcı başvurusu (M3'ten önce); Amazon SP-API geliştirici kaydı (M4'ten önce); barındırma sağlayıcısı seçimi (M4'ten önce).
