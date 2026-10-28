# Ticaret Merkezi 2.0 — Frontend

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui. Next.js sunucusu aynı zamanda BFF'tir: tarayıcı backend'e doğrudan erişmez. Güvenlik modeli: [`docs/SECURITY.md` §5](../docs/SECURITY.md).

## Çalıştırma (geliştirme)

Gerekenler: Docker (PostgreSQL + Redis), backend, kök dizinde `.env` (bkz. `.env.example`; `SESSION_SECRET`, `APP_ORIGIN`, `BACKEND_URL` ve backend için `TRUST_PROXY=loopback`, `CORS_ORIGINS=`).

```bash
docker compose -f docker/docker-compose.yml up -d   # PostgreSQL + Redis
cd backend && npm run start:dev                      # http://localhost:4000
cd frontend && npm install && npm run dev            # http://localhost:3000
```

`http://localhost:3000/register` ile mağaza oluşturun veya `/login` ile giriş yapın.

## Production

```bash
npm run build
NODE_ENV=production npm start
```

`npm start` ve `npm run dev`, `server.mjs` üzerinden çalışır (`next start`/`next dev` değil): istemci IP'si ve protokol orada güvenilir proxy listesine göre belirlenir, production'da HTTP reddedilir. Next.js'in `standalone` çıktısı bu dosyayı içermez; kullanmayın.

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Production derlemesi |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit testler (Vitest; oturum testleri Docker'daki Redis'i kullanır) |
| `npm run test:e2e` | Tarayıcı testleri (Playwright). Backend :4000 ve frontend :3000 çalışıyor olmalı. |

## Yapı

- `server.mjs` — giriş noktası: güvenilir istemci IP'si, HTTPS zorunluluğu
- `src/proxy.ts` — oturumsuz kullanıcıyı `/login`'e yönlendirir (Next.js 16'da middleware)
- `src/server/` — yalnızca sunucu: oturum deposu, refresh kilidi, CSRF, BFF izin listesi, backend istemcisi
- `src/app/api/` — BFF route handler'ları (`auth/*`, `session`, `bff/[...path]`)
- `src/app/(auth)`, `src/app/(app)` — sayfalar
- `src/hooks/queries.ts` — TanStack Query hook'ları
