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

## Yol haritası ve durum takibi

Yol haritası `docs/roadmap/` altındadır. Görevlerin tek kaynağı `TASK_REGISTER.md`, anlık durum `PROJECT_STATUS.md`'dir. Görev ID'leri kalıcıdır; yeniden numaralandırılmaz, iptal edilen görev silinmez, durumu ve nedeni yazılır.

### Durum geçişleri

`PLANNED` → `IN-PROGRESS` → `DONE-PR` → `DONE-NOT-DEPLOYED` → `DONE-MERGED`. Herhangi bir aşamadan `BLOCKED`'a geçilebilir (neden "Durum" hücresine yazılır).

- `DONE-MERGED` yalnızca merge edilmiş **ve** dev'e deploy edilmiş görev içindir. Merge edilip deploy edilmeyen görev `DONE-NOT-DEPLOYED` kalır.
- PR'da olup merge edilmemiş iş hiçbir zaman "tamamlandı/merge edildi" diye raporlanmaz.

### Kim, ne zaman günceller

Görevi yürüten ajan, aynı dalda ve aynı PR içinde:

1. **Başlarken:** `TASK_REGISTER.md`'de durumu `IN-PROGRESS` yapar.
2. **Görev bitince (testler yeşil, CRITICAL'de inceleme temiz):** durumu `DONE-PR (PR #N)` yapar; `PROJECT_STATUS.md`'de §1 özet sayıları, modül yüzdeleri, §2 (açık PR içeriği), §4 sıradaki görevler ve §6 durum geçmişine bir satır (tarih, görev, PR bağlantısı, test sonuçları geçen/toplam, deploy durumu) ekler. Yeni risk bulunduysa §5'e eklenir; kapanan risk "Bugünkü durum" sütununda kapatılır.
3. **Merge sonrası** (yalnızca kullanıcı onayıyla yapılan merge): durumu `DONE-NOT-DEPLOYED` yapar.
4. **Dev deploy sonrası:** `DONE-MERGED (PR #N)` yapar; `PROJECT_STATUS.md`'deki "Dev ortamında çalışan kod" satırını commit SHA ile günceller.

Merge ve deploy sonrası güncellemeler küçük bir `docs/` dalında yapılır. Test sonuçları her zaman o anda gerçekten koşulan sonuçlardır; eski sonuç yeni diye yazılmaz.

### Çalışma modları (FAST / STANDARD / CRITICAL)

Her görevin modu `TASK_REGISTER.md`'de yazılıdır; yürüten ajan riski yüksek görürse modu yükseltebilir, düşüremez.

- **FAST** — düşük risk (UI listesi, dışa aktarma, doküman). Tek uygulayıcı; ek inceleyici ajan yok. Yalnızca etkilenen paketin testleri + lint/typecheck.
- **STANDARD** — normal özellik. Uygulayıcı öz-incelemesi; ilgili test paketleri; tam paket PR öncesi bir kez.
- **CRITICAL** — güvenlik, kimlik doğrulama/yetki, tenant izolasyonu, ödeme, kimlik bilgisi saklama, veri migration'ı. Uygulayıcıdan **bağımsız bir inceleyici** (ayrı ajan, uygulayıcının bağlamını devralmaz) diff'i inceler; bulgular kapanmadan `DONE-PR` olmaz. Migration'larda ek olarak izole prova (`backup-and-rehearse.sh`) ve dev DB için kullanıcı onayı.

Gereksiz tekrar yapılmaz: aynı commit üzerinde yeşil koşmuş test paketi değişiklik olmadan yeniden koşulmaz; bir görev için birden fazla inceleyici ajan açılmaz (CRITICAL'de bir bağımsız inceleyici yeterlidir, düzeltmeden sonra aynı inceleyici yeniden bakar); kod değiştirmeyen doküman güncellemeleri için test koşulmaz.
