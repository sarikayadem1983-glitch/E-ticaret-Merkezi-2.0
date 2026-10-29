# MVP Planı (Sürüm A)

> **Onay durumu:** Yalnızca kullanıcı yönetimi planındaki görevler (`USR-T1`…`USR-T16`, plan: `docs/superpowers/plans/2026-10-28-user-management.md`) ve merge edilmiş işler (INF-01…08, USR-01, USR-02, DSH-01) **onaylı plandır**. Diğer tüm modüller, görevler, tahminler ve tarihler **öneridir, kullanıcı onayı beklemektedir**. Her görevin kaynağı `TASK_REGISTER.md`'deki "Kaynak" sütunundadır.

Amaç: pilot satıcının ürünlerini tek yerden yönetip Trendyol ve Hepsiburada'da satabildiği, siparişlerini, stoklarını ve iadelerini işleyebildiği ilk çalışan platform. Çıkış kriterleri: `RELEASE_PLAN.md`.

**Kapsam:** 69 görev — 18 tamamlandı (11 `DONE-MERGED`, 7 `DONE-PR`), 51 kalan, 149 iş günü, hedef 2027-03-19.

## Kapsam dışı (bilinçli)

e-Fatura (pilot satıcı mevcut entegratörünü kullanır; B'de gelir), abonelik/ödeme, Amazon/n11 ve diğer pazaryerleri, kârlılık ve hakediş, prod ortamı (MVP dev/kontrollü pilot ortamda çalışır), AI özellikleri.

## Fazlar

### Faz 0 — PR #6'yı kapatma (M0, 2026-11-06)

Görev değil, kapı: PR #6 bağımsız inceleme, tam test, kullanıcı onayıyla merge, dev deploy. Önkoşullar: `PROJECT_STATUS.md` §3.

### Faz 1 — Kimlik ve yetki temelini bitirme (M1, 2026-11-27)

| Akış 1 | Akış 2 |
|---|---|
| USR-T7 (onay sonrası) → USR-T8 → CAT-01 → CAT-02 | INF-18 → INF-19 → USR-T9 → USR-T10 → USR-T11 |
| INF-10 CI (araya) | INF-09 kuyruk |

Faz sonunda: firma başına rol her istekte uygulanıyor; davet ve kullanıcı yönetimi backend'i hazır; CI zorunlu.

### Faz 2 — Katalog ve operasyon çekirdeği (M2, 2026-12-25)

| Akış 1 | Akış 2 |
|---|---|
| CAT-03 → CAT-05 → CAT-04 → INF-12 → IMG-01 → IMG-02 | USR-T12 → USR-T13 → USR-T14 → USR-T15 → USR-T16 → USR-19 |
| IMP-01 → IMP-02 | ORD-01 → INV-01 → ORD-02 → INV-02 |

### Faz 3 — Entegrasyon çerçevesi ve Trendyol (M3, 2027-02-05)

| Akış 1 | Akış 2 |
|---|---|
| INT-01 → INT-02 → CAT-06 → INT-TY-01 → INT-TY-03 → INT-TY-02 | INT-03 → INT-04 → ORD-03 → INV-03 → CRM-01 → OPS-01 |

### Faz 4 — Hepsiburada, iade/kargo, raporlama (M4, 2027-03-05)

| Akış 1 | Akış 2 |
|---|---|
| INT-HB-01 → INT-HB-03 → INT-HB-02 | SHP-01 → SHP-02 → RPT-01 → RPT-02 → DSH-02 → CRM-02 → OPS-03 |

### Faz 5 — Kabul (A, 2027-03-19)

Uçtan uca senaryo (sandbox), izolasyon paketleri, yedek tatbikatı, açık risk taraması, kullanıcı kabulü.

## Görev listesi (kalan 51)

| Faz | Görevler | İş günü |
|---|---|---|
| 1 | USR-T7, USR-T8, USR-T9, USR-T10, USR-T11, INF-09, INF-10, INF-18, INF-19, CAT-01, CAT-02 | 28 |
| 2 | USR-T12, USR-T13, USR-T14, USR-T15, USR-T16, USR-19, CAT-03, CAT-04, CAT-05, INF-12, IMG-01, IMG-02, IMP-01, IMP-02, ORD-01, ORD-02, INV-01, INV-02 | 48 |
| 3 | INT-01, INT-02, INT-03, INT-04, CAT-06, INT-TY-01, INT-TY-02, INT-TY-03, ORD-03, INV-03, CRM-01, OPS-01 | 40 |
| 4 | INT-HB-01, INT-HB-02, INT-HB-03, SHP-01, SHP-02, RPT-01, RPT-02, DSH-02, CRM-02, OPS-03 | 33 |
| **Toplam** | **51** | **149** |

## MVP riskleri

- Trendyol/Hepsiburada sandbox erişimi gecikirse Faz 3–4 kayar (görev `BLOCKED`).
- USR-T7 onayı bekleniyor; kritik yolun ilk adımı.
- Her yeni şema görevi (CAT-01, ORD-01, INV-01, INT-01) ayrı migration onayı gerektirir (G3).
