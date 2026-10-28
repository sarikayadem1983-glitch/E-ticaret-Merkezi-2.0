# Güvenlik

Bu doküman uygulamanın güvenlik modelini ve ortam bazlı yapılandırmasını tanımlar. Tenant izolasyonu ve Audit Log tasarımı için bkz. [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Veritabanı rolleri (en az yetki)

Uygulama PostgreSQL'e **superuser ile bağlanmaz**.

| Rol | Kullanım | Yetkiler |
|---|---|---|
| `postgres` (superuser) | Yalnızca bootstrap: rolleri oluşturmak (`database/roles/setup-roles.sql`) | Tümü. Uygulama veya CI bu hesabı kullanmaz. |
| `tm_migrator` | `prisma migrate deploy` / `migrate diff` (`MIGRATION_DATABASE_URL`) | `public` şemasının ve tüm nesnelerin sahibi. Superuser değil, rol/veritabanı oluşturamaz. |
| `tm_app` | Çalışan uygulama (`DATABASE_URL`) | `CONNECT`, şemada `USAGE` (CREATE yok). İş tablolarında `SELECT, INSERT, UPDATE, DELETE`. `audit_logs`'ta yalnızca `SELECT, INSERT`. `_prisma_migrations`'a erişim yok. `TRUNCATE`, `REFERENCES`, `TRIGGER` yok. |

- Yeni tablolar `tm_migrator` tarafından oluşturulur. `ALTER DEFAULT PRIVILEGES`, `tm_app`'e otomatik olarak `SELECT, INSERT, UPDATE, DELETE` verir. **Append-only** olması gereken yeni tablolar için migration içinde açıkça `REVOKE UPDATE, DELETE` yazılmalıdır.
- `PUBLIC` rolünden veritabanı ve şema üzerindeki `CREATE`/`TEMP` yetkileri alınır.
- Uygulama açılışta bağlandığı rolü kontrol eder. Rol superuser veya `BYPASSRLS` ise production'da **başlamaz**, diğer ortamlarda uyarı loglar.

### Audit Log değiştirilemezliği (katmanlar)

1. API'de yazma endpoint'i yoktur.
2. Prisma eklentisi `AuditLog` üzerinde update/delete/upsert'i reddeder.
3. `tm_app`'in `audit_logs` üzerinde `UPDATE`, `DELETE`, `TRUNCATE` yetkisi yoktur.
4. Trigger `UPDATE`, `DELETE`, `TRUNCATE`'i reddeder. Trigger'ı yalnızca tablo sahibi (`tm_migrator`) kapatabilir.
5. Purge kapısı (`app.allow_audit_purge = 'on'`) yalnızca tablo sahibi rolünün oturumunda geçerlidir. `tm_app` bu ayarı yapsa da silemez.

### Kurulum

Yeni Docker volume'unda roller otomatik oluşturulur (`docker/postgres/init/10-roles.sh`). Mevcut bir veritabanında bir kez çalıştırın (veri kaybı yok; nesnelerin sahibi `tm_migrator` olur):

```bash
sh docker/postgres/setup-roles.sh
```

Script tekrar çalıştırılabilir (idempotent). Şifre değiştirmek için `.env`'deki değeri güncelleyip yeniden çalıştırın.

### Production bağlantı bilgileri

- `DATABASE_URL` ve `MIGRATION_DATABASE_URL` ayrı gizli değerlerdir. Bir secret manager (ör. AWS Secrets Manager, GCP Secret Manager, Vault, Kubernetes Secret) ile ortam değişkeni olarak verilir. Repoya, imaja veya loglara yazılmaz.
- Çalışan uygulamaya **yalnızca** `DATABASE_URL` verilir. `MIGRATION_DATABASE_URL` yalnızca deploy/migration işine verilir.
- Bağlantı TLS ile yapılır: `?sslmode=verify-full` (sertifika doğrulamalı).
- Şifreler en az 32 karakter rastgele üretilir ve düzenli döndürülür.
- Yönetilen PostgreSQL'de `postgres`/admin hesabı uygulamaya verilmez.

## 2. HTTP katmanı

> Bu aşamada geliştiriliyor.

## 3. Kimlik doğrulama koruması

> Bu aşamada geliştiriliyor.
