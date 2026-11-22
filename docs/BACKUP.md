# Yedekleme ve geri yükleme (OPS-03)

## Durum

- **Dev:** `database/scripts/backup.sh` (doğrulamalı mantıksal yedek + nesne depolama). Zamanlayıcı kurulmadı.
- **Prod:** altyapı seçilmedi; sürekli WAL arşivi/PITR ve yedeklerin başka konumda, şifreli tutulması **yapılmadı**. Bu belge tek başına OPS-03'ü kapatmaz.

## RPO / RTO

| Ortam | RPO | RTO | Kaynak |
|---|---|---|---|
| Dev (`backup.sh`) | Zamanlayıcı kurulana kadar sınırsız; günlük çalışmada hedef 24 saat | < 15 dk (hedef) | 2026-11-22: 546 651 bayt dump; yedek + geri yükleme doğrulaması 6–10 sn |
| Prod (hedef, onay bekliyor) | 5 dk | 1 saat | PITR ile; prod verisiyle ölçülmedi |

## Yedek

`bash database/scripts/backup.sh <repo dışı klasör> [saklanacak adet]` — her çalışmada dump'ı geçici bir veritabanına geri yükler, satır sayılarını karşılaştırır, SHA-256 yazar. Başarısız çalışma eski yedekleri silmez. Yedek gerçek kullanıcı verisi içerir; şifrelenmez, erişimi kısıtlı bir klasörde tutulmalıdır.

Nesne arşivi çalışan MinIO'dan alınır: veritabanıyla aynı anın görüntüsü değildir ve o anda yazılan nesne yarım olabilir. Tutarlı arşiv için yükleme yapılmazken alın. MinIO kapalıysa betik hata verir; bilerek atlamak için `TM_SKIP_OBJECTS=1`.

Windows'ta `umask` etkisizdir: yedek klasörünün ACL'ini elle kısıtlayın. Denetim `public` şemasıyla sınırlıdır; sequence değerleri karşılaştırılmaz.

## Geri yükleme

1. `sha256sum -c <db>-<zaman>.sha256`
2. Yeni, boş bir veritabanı oluşturun; kaynak veritabanının üzerine yazmayın. Temiz kümede önce roller kurulur: `database/roles/setup-roles.sql` (`app_password`, `migrator_password` psql değişkenleri; dump rolleri içermez).
3. `docker exec -i tm-postgres pg_restore -U <POSTGRES_USER> -d <yeni_db> --exit-on-error < <dump>`. Aynı kümede her yedekte denenir; temiz küme: aşağıdaki tatbikat.
4. Nesneler: `<db>-<zaman>.objects.tar` içindeki `data/` MinIO birimine açılır (MinIO kapalıyken). Dosya sahibi `minio` olmalı (`chown -R minio /data`).
5. Uygulamayı yeni veritabanına yönlendirin, `/health` ve smoke.

## Temiz ortam tatbikatı

`bash database/scripts/restore-rehearsal.sh <set>.sha256` — yeni PostgreSQL kümesi, yeni MinIO ve backend, geçici konteynerlerde. 2026-11-22 (dev verisi, 595 051 bayt dump): 42 tablo eşit, migration'lar güncel, 6 etkin görsel okundu ve çözüldü, anonim 403, `/health` ok; toplam 28 sn. Negatif: bozuk arşiv (SHA-256) ve eksik nesne (`NoSuchKey`) tatbikatı başarısız yaptı. Prod boyutu için süre ölçümü değildir. Önkoşul: derlenmiş güncel `backend/dist`, `backend/node_modules`, `tm-minio:dev`. PostgreSQL, MinIO ve Redis konteynerde; backend ana makinede, yalnız loopback'te, repo `.env`'i olmadan çalışır. Denetim çalışma ağacındaki kod ve migration'larla yapılır (eski yedekte bekleyen migration hatadır). Kapsam dışı: silinmiş görsellerin içeriği (yalnız nesne sayısı), sequence değerleri, oturum açma akışları. `kill -9` sonrası `tm-drill` etiketli kalıntı elle silinir; betik kalıntı varken başlamaz.

## PITR tatbikatı

`bash database/scripts/pitr-rehearsal.sh` — sentetik veri, geçici konteynerler; temel yedek + WAL arşivi ile silme kazasından önceki ana döner. 2026-11-22: başarılı, kurtarma 7 sn (önemsiz boyutta veri; prod süresi değildir).
