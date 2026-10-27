# Ticaret Merkezi 2.0

Çok kanallı e-ticaret yönetim merkezi. Ürün, stok, sipariş ve pazaryeri entegrasyonlarını tek panelden yönetmeyi hedefler.

## Durum

Sprint 0 — proje iskeleti ve dokümantasyon. Henüz uygulama kodu yok.

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

Teknoloji yığını kesinleştiğinde eklenecek.
