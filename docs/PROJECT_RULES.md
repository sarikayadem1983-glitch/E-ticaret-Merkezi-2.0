# Proje Kuralları

## Genel

- Her değişiklik bir sprint görevine bağlı olmalı.
- Kod yazmadan önce ilgili doküman güncellenir (mimari, veritabanı, API).
- Gizli bilgiler (`.env`, API anahtarları, pazaryeri kimlik bilgileri) asla repoya girmez. Şablon `.env.example` dosyasında tutulur.

## Git

- Ana dal: `main`. Doğrudan `main`'e commit yapılmaz.
- Dal adları: `feature/<konu>`, `fix/<konu>`, `docs/<konu>`, `chore/<konu>`.
- Commit mesajları Conventional Commits biçiminde: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Birleştirme Pull Request ile yapılır.
- CI (`.github/workflows/ci.yml`) her PR'da ve `main`'e push'ta çalışır: backend (lint, build, unit, e2e; servis konteynerinde PostgreSQL 16 + Redis 7, `setup-roles.sql` + `prisma migrate deploy`) ve frontend (lint, `next typegen` + typecheck, unit, build). Yalnızca iş akışının kendi konteynerleri için geçici değerler kullanılır; depo sırrı (secret) kullanılmaz. Kırmızı CI ile merge yapılmaz.

## Kod

- Adlandırma: kod ve veritabanı İngilizce, kullanıcı arayüzü metinleri Türkçe (i18n ile).
- Her modül kendi klasöründe, katmanlara ayrılmış olarak durur (bkz. ARCHITECTURE.md).
- İş mantığı controller/route içine yazılmaz; servis katmanında olur.
- Yeni özellik testle birlikte gelir.

## Veritabanı

- Şema değişikliği yalnızca migration ile yapılır. Elle değişiklik yasak.
- Migration geri alınabilir olmalı.
- Migration'lar yalnızca `prisma migrate deploy` ile uygulanır; `prisma migrate dev` / `db push` kullanılmaz (Prisma'nın gösteremediği yalnızca-SQL nesneler var, bkz. docs/DATABASE.md). Bu nesneler için migration elle yazılır.
- Para tutarları ondalık (decimal) tipinde, para birimiyle birlikte saklanır. Float kullanılmaz.

## API

- REST, sürümlü: `/api/v1/...`.
- Her endpoint API_DOCUMENTATION.md'ye işlenir.
- Yanıt biçimi standarttır (bkz. API_DOCUMENTATION.md).

## Güvenlik

- Tüm girdiler doğrulanır.
- Kimlik doğrulama ve yetkilendirme her korumalı endpoint'te zorunludur.
- Loglara kişisel veri veya gizli bilgi yazılmaz.
