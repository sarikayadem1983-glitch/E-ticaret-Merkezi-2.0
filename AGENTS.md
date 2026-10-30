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

## Pull Request otomasyonu

Git kuralları için `docs/PROJECT_RULES.md` (Git) geçerlidir. Ajanlar ek olarak:

- Geliştirme bitince ilgili testleri çalıştırır (backend: `npm test`, `npm run test:e2e`; frontend: `npm test`, `npm run lint`, `npm run typecheck`, gerekirse Playwright). Çalışan Next.js dev sunucusunun üzerinde `next build` çalıştırılmaz.
- Değişiklikleri `feature/<konu>` (veya `fix/`, `docs/`, `chore/`) dalında commit eder ve push eder. `main`'e doğrudan commit veya push yapılmaz.
- PR'ı `gh` ile kendisi yönetir, kullanıcıdan tarayıcıdan PR açmasını istemez:
  - Dal için açık PR varsa (`gh pr view`) yeni PR açılmaz; başlık/açıklama `gh pr edit` ile güncellenir.
  - Yoksa `gh pr create` ile açılır. Hedef dal `main`; dal başka bir açık feature dalının üstüne kuruluysa o dal.
  - PR oluşturmak/güncellemek için kullanıcı onayı beklenmez.
- PR açıklaması: yapılan değişikliklerin özeti, güncel test sonuçları (geçen/toplam), bilinen riskler.
- Test başarısızsa gizlenmez: PR `--draft` açılır (veya `gh pr ready --undo`), başarısız testler ve nedenleri açıklamada yazılır.
- `.env`, şifre, token, API anahtarı ve diğer gizli bilgiler commit edilmez; commit öncesi `git status` ve diff kontrol edilir.
- **Merge yalnızca kullanıcının sohbetteki açık onayıyla yapılır.** Otomatik merge, `--auto` veya onaysız `gh pr merge` yok.
- İş bitince kullanıcıya PR bağlantısı ve test sonuçları bildirilir.
- `gh` oturumu yoksa kullanıcıdan bir kez `gh auth login` yapması istenir.
