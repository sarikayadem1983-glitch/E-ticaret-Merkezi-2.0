# Sürüm Planı

> **Onay durumu:** Yalnızca kullanıcı yönetimi planındaki görevler (`USR-T1`…`USR-T16`, plan: `docs/superpowers/plans/2026-10-28-user-management.md`) ve merge edilmiş işler (INF-01…08, USR-01, USR-02, DSH-01) **onaylı plandır**. Diğer tüm modüller, görevler, tahminler ve tarihler **öneridir, kullanıcı onayı beklemektedir**. Her görevin kaynağı `TASK_REGISTER.md`'deki "Kaynak" sütunundadır.

Görev listeleri `TASK_REGISTER.md`'deki "Sürüm" sütunundan türetilir. Tahmin varsayımları: `MASTER_ROADMAP.md` §6. Sürüm başına tam görev tabloları (durum, tahmin, mod, kaynak): `TASK_REGISTER.md` → "Sürümlere göre görev listeleri".

## Sürüm A — MVP: Trendyol-only e-ticaret operasyon platformu (kullanıcı kararı, 2026-10-29)

**Hedef kullanıcı:** pilot satıcılar (ücretsiz/erken erişim), kontrollü ortam.

**Zorunlu özellikler:** çoklu tenant ve firma başına rol (USR-T7/T8), temel rol/yetki yönetimi, davetle ekip ekleme ve personeli pasife alma (MVP dilimleri USR-T9a…T15a), şifre sıfırlama, yetki yükseltme güvenlik paketi (USR-T14); ürün kataloğu (varyant, fiyat, görsel, Excel/CSV içe aktarma); Trendyol'da listeleme, stok/fiyat senkronu, sipariş içeri alma, iptal (tedarik edememe) ve iade (claim) senkronu ile yerel stok iadesi; sipariş ekranları, stok rezervasyonu ve düşümü, Trendyol kargo etiketi; temel satış raporu; hata izleme, otomatik yedek.

**Görevler:** 57 (20 tamamlandı, 37 kalan). Kalan: INF-09, INF-10, INF-12, INF-18 · USR-T9a, USR-T10a, USR-T11a, USR-T12a, USR-T13a, USR-T14, USR-T15a, USR-T16, USR-19 · CAT-01…CAT-06 · IMP-01 · IMG-01 · INT-01…INT-03 · INT-TY-01…03 · ORD-01…ORD-03 · INV-01…INV-03 · SHP-02 · RPT-01 · OPS-01, OPS-03.

**İş yükü:** 106,5 iş günü (takvim değil). **Takvim:** M0'dan sonra ≈ 62 iş günü + 5 iş günü kabul → **tahmini hedef 2027-02-03** (taahhüt değil). Hesap: `MVP_PLAN.md` §3.

**Çıkış kriterleri:**
1. Tüm A görevleri `DONE-MERGED` ve dev'e deploy edilmiş; CI yeşil.
2. Trendyol stage ortamında uçtan uca senaryo: ürün oluştur → Trendyol'da listele → test siparişi gelir → stok düşer → etiket → müşteri iptali ve tedarik edememe stok geri alır → iade claim'i onaylanır → stok geri gelir.
3. USR-T14 yetki yükseltme/tenant izolasyonu paketi ve her modülün izolasyon testleri PASS.
4. INF-18 kapalı; kritik açık risk yok (`PROJECT_STATUS.md` §5). INF-19 B'de kabul edilmiş risk olarak listelenir.
5. Yedekten geri yükleme tatbikatı (OPS-03) başarılı.
6. Kullanıcının pilot kabulü.

## Sürüm B — Ticari SaaS: ücretli müşteriye satılabilir, güvenli, yönetilebilir

**Zorunlu özellikler:** MVP'den ertelenenler: Hepsiburada, genel iptal/iade iş akışı ve iade UI, webhook alıcısı, asenkron içe aktarma, görsel türev/uygunluk, KPI dashboard, müşteri modeli ve UI, stok raporları, BFF `forceRefresh` yarışı, kullanıcı yönetimi kalan kısımları (USR-T9…T13, T15: `T9b`…`T15b`); abonelik planları, kartla ödeme, limitler; e-Arşiv/e-Fatura kesimi, iptal/iade faturası; kârlılık ve gider hesaplama; hakediş ve mutabakat; Amazon TR ve n11; manuel sipariş, çoklu depo, tedarikçi; kampanya yönetimi; anlaşmalı kargo; dışa aktarma ve zamanlanmış rapor; bildirim merkezi; 2FA; Aşama 2 migration; staging + prod deploy, Redis HA, secret yönetimi, TLS/ağ, CAPTCHA, nonce CSP, enumeration düzeltmesi; izleme/alarm, süper admin paneli, KVKK süreçleri, yük testi, bağımsız güvenlik denetimi.

**Görevler:** 61 — MVP'den ertelenen 18: INT-HB-01…03, SHP-01, INT-04, IMP-02, IMG-02, DSH-02, CRM-01, CRM-02, RPT-02, INF-19, USR-T9…T13, USR-T15 (kalan kısımlar) · önceki 43: INF-11, INF-13…INF-17, INF-20 · USR-18, USR-20 · DSH-03 · IMP-03, IMP-04 · INT-AMZ-01…03, INT-N11-01…03 · ORD-04 · INV-04 · SHP-03 · EFT-01…EFT-04 · CRM-03 · CMP-01 · PRF-01…03 · STL-01…03 · RPT-03 · SUB-01…04 · OPS-02, OPS-04…OPS-07. Tahmin: 188,5 iş günü (149 + ertelenen 35 + kullanıcı yönetimi kalanları 4,5).

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

Tüm tarihler **tahmini hedeftir, taahhüt değildir**. Yöntem: kalan iş yükü / 2 paralel akış, +%15 tampon (onay gecikmesi dahil), resmî tatiller (1 Ocak, Ramazan Bayramı ~9–11 Mart 2027, 23 Nisan, 1 Mayıs, Kurban Bayramı ~16–19 Mayıs 2027, 15 Temmuz, 30 Ağustos, 29 Ekim) düşülmüş. Dış erişim gecikirse ilgili kilometre taşı kayar.

| Kilometre taşı | Tahmini hedef | İçerik |
|---|---|---|
| M0 | 2026-10-29 (merge tamam) | PR #6, #8, #9 kullanıcı onayıyla merge edildi; dev deploy ayrı onay bekliyor |
| M1 | 2026-11-25 | Kullanıcı yönetimi backend dilimleri, INF-09/10/18, CAT-01/02/03/05, görsel |
| M2 | 2026-12-25 | Entegrasyon çerçevesi, kanal eşleme, katalog UI, içe aktarma, kullanıcı yönetimi PR'ı, şifre sıfırlama, sipariş/stok çekirdeği |
| M3 | 2027-01-27 | Trendyol uçtan uca (listeleme, stok/fiyat, sipariş, iptal/iade, kargo), raporlar, yedek tatbikatı |
| **A — MVP** | **2027-02-03 (tahmini)** | Kabul testi ve pilot başlangıcı |
| M5 | 2027-04-21 | Abonelik/ödeme, e-Fatura, staging/prod altyapısı, Hepsiburada |
| M6 | 2027-06-29 | Amazon TR, n11, kârlılık, hakediş, KVKK, süper admin |
| **B — Ticari** | **2027-07-27 (tahmini)** | 188,5 iş günü; güvenlik denetimi kapandı, satışa açılış |
| **C — Gelişmiş** | **2027-10-06 (tahmini)** | AI, kampanya optimizasyonu, gelişmiş analitik, 7 pazaryeri |
> B ve C tarihleri 2026-10-29 güncellemesinde yeniden hesaplanmadı (A hedefi 2027-02-12 → 2027-02-03 öne alındı; B/C bu kaydırmayı henüz yansıtmıyor, A kabulünden sonra yeniden kalibre edilecek).

**Önceden başlatılması gereken dış işler:** Trendyol satıcı hesabı, API anahtarı ve stage erişimi/IP whitelist (M1'den önce; MVP'nin ana dış kapısı); Hepsiburada SIT erişimi, e-Fatura entegratör sözleşmesi ve ödeme sağlayıcı başvurusu (A'dan önce); Amazon SP-API geliştirici kaydı ve barındırma sağlayıcısı seçimi (M5'ten önce).
