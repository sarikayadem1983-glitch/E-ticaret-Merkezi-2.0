# Docker — Yerel Geliştirme Ortamı

Servisler: PostgreSQL 16 (`tm-postgres`, port 5432), Redis 7 (`tm-redis`, port 6379), Mailpit (`tm-mailpit`, yalnızca `127.0.0.1`: SMTP 1025, arayüz http://localhost:8025). Mailpit tüm e-postaları yakalar, dışarı göndermez; backend'de `MAIL_TRANSPORT=smtp`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`.

Komutlar proje kök dizininden çalıştırılır:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d
docker compose --env-file .env -f docker/docker-compose.yml ps
docker compose --env-file .env -f docker/docker-compose.yml down
```

Veriler `postgres_data` ve `redis_data` volume'larında kalır. Silmek için `down -v` kullanılır (geri alınamaz).
