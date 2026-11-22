# Yedekleme ve geri yükleme (OPS-03)

## Durum

- **Dev:** `database/scripts/backup.sh` (doğrulamalı mantıksal yedek + nesne depolama). Zamanlayıcı kurulmadı.
- **Prod:** altyapı seçilmedi; sürekli WAL arşivi/PITR ve yedeklerin başka konumda, şifreli tutulması **yapılmadı**. Bu belge tek başına OPS-03'ü kapatmaz.

## RPO / RTO

| Ortam | RPO | RTO | Kaynak |
|---|---|---|---|
| Dev (günlük `backup.sh`) | 24 saat | < 15 dk (hedef) | 2026-11-22: 546 651 bayt dump; yedek + geri yükleme doğrulaması 6–10 sn |
| Prod (hedef, onay bekliyor) | 5 dk | 1 saat | PITR ile; prod verisiyle ölçülmedi |

## Yedek

`bash database/scripts/backup.sh <repo dışı klasör> [saklanacak adet]` — her çalışmada dump'ı geçici bir veritabanına geri yükler, satır sayılarını karşılaştırır, SHA-256 yazar. Başarısız çalışma eski yedekleri silmez. Yedek gerçek kullanıcı verisi içerir; şifrelenmez, erişimi kısıtlı bir klasörde tutulmalıdır.

Veritabanı ve nesne arşivi aynı anın görüntüsü değildir (aralarında saniyeler vardır).

## Geri yükleme

1. `sha256sum -c <db>-<zaman>.sha256`
2. Yeni, boş bir veritabanı oluşturun; kaynak veritabanının üzerine yazmayın.
3. `pg_restore -d <yeni_db> --exit-on-error < <dump>`; rol yetkileri için `database/roles/setup-roles.sql`.
4. Nesneler: `<db>-<zaman>.objects.tar` içindeki `data/` MinIO birimine açılır (MinIO kapalıyken). Bu adım tatbik edilmedi.
5. Uygulamayı yeni veritabanına yönlendirin, `/health` ve smoke.

## PITR tatbikatı

`bash database/scripts/pitr-rehearsal.sh` — sentetik veri, geçici konteynerler; temel yedek + WAL arşivi ile silme kazasından önceki ana döner. 2026-11-22: başarılı, kurtarma 7 sn (önemsiz boyutta veri; prod süresi değildir).
