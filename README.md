# Ticaret Merkezi 2.0

Çok kanallı e-ticaret yönetim merkezi. Ürün, stok, sipariş ve pazaryeri entegrasyonlarını tek panelden yönetmeyi hedefler.

## Durum

Backend temeli (`v0.1.0-backend-foundation`): NestJS, Prisma, zorunlu tenant izolasyonu, auth. Frontend henüz yok.

## Teknoloji Yığını

| Katman | Teknolojiler |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, Shadcn UI, TanStack Query, Zustand |
| Backend | NestJS, TypeScript, Prisma ORM |
| Veritabanı | PostgreSQL |
| Önbellek / Kuyruk | Redis |
| Altyapı | Docker, Docker Compose |
| Kimlik Doğrulama | JWT, Refresh Token, RBAC |
| AI | Bağımsız AI Engine modülü |

Mimari: modüler monolit, multi-tenant SaaS, ileride mikroservise bölünebilir yapı. Ayrıntılar: [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Klasör Yapısı

| Klasör | Amaç |
|---|---|
| `backend/` | API ve iş mantığı |
| `frontend/` | Yönetim paneli arayüzü |
| `database/` | Migration, seed ve şema dosyaları |
| `docker/` | Container ve yerel geliştirme ortamı tanımları |
| `docs/` | Proje kuralları, mimari, veritabanı ve API dokümantasyonu |

## Dokümantasyon

- [Proje Kuralları](docs/PROJECT_RULES.md)
- [Mimari](docs/ARCHITECTURE.md)
- [Veritabanı](docs/DATABASE.md)
- [API Dokümantasyonu](docs/API_DOCUMENTATION.md)

## Kurulum

Gereksinimler: Node.js 24, npm 11, Docker Desktop.

```bash
cp .env.example .env          # JWT_ACCESS_SECRET'ı doldurun (en az 32 karakter)
docker compose --env-file .env -f docker/docker-compose.yml up -d

cd backend
npm ci
npm run prisma:generate       # npm 11 kullanıyorsanız zorunlu, aşağıya bakın
npm run prisma:deploy         # migration'ları uygular
npm run start:dev             # http://localhost:4000/api/v1/health
```

> **npm 11 notu:** npm 11 paketlerin kurulum scriptlerini varsayılan olarak çalıştırmaz. Bu yüzden `postinstall` içindeki `prisma generate` atlanır ve Prisma client (`backend/src/generated/`) oluşmaz; uygulama ve testler `Cannot find module '../generated/prisma/client.js'` hatası verir. `npm ci` / `npm install` sonrası ve `database/prisma/schema.prisma` her değiştiğinde `npm run prisma:generate` çalıştırın.

Testler (Docker'daki PostgreSQL çalışıyor olmalı):

```bash
npm test             # unit
npm run test:e2e     # e2e, gerçek veritabanı kullanır
npm run lint
```
