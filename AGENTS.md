# Ticaret Merkezi 2.0

Multi-tenant e-ticaret yönetim SaaS. Modüler monolit.

- Frontend: `frontend/` — Next.js (App Router), TypeScript, Tailwind, Shadcn UI, TanStack Query, Zustand
- Backend: `backend/` — NestJS, TypeScript, Prisma, PostgreSQL, Redis
- Auth: JWT + refresh token, RBAC

## Kurallar

- Kod yazmadan önce `docs/` altındaki ilgili dokümanı oku ve güncelle.
- Kurallar: `docs/PROJECT_RULES.md`. Mimari: `docs/ARCHITECTURE.md`.
- Tenant'a ait her sorgu `tenant_id` ile filtrelenir.
- Modüller birbirinin tablosuna doğrudan erişmez.
- `ai-engine` diğer modüllerden bağımsızdır.
