# INT-02 Senkron Motoru Uygulama Planı

> **Ajan uygulayıcılar için:** ZORUNLU ALT BECERİ: görev görev uygulamak için superpowers:subagent-driven-development (önerilen) veya superpowers:executing-plans kullanın. Adımlar `- [ ]` onay kutularıyla izlenir.

**Amaç:** Pazaryeri senkron işlerini (ürün gönderme, stok/fiyat, sipariş çekme) tek bir motordan çalıştırmak: kanal hesabı başına hız sınırı, sınıflandırılmış yeniden deneme, idempotency, kullanıcıya görünen senkron logu ve dış kayıtlar için çakışma çözümü.

**Mimari:** Motor, INF-09 kuyruğunun (`QueueService`) üzerine ince bir katmandır. Her senkron işi `sync_jobs` tablosunda bir satırdır (log + durum); kuyruk işi yalnızca `syncJobId` taşır, kimlik bilgisi taşımaz. Tür (kind) başına handler kayıt defteri vardır; INT-TY-01…03 kendi handler'larını buraya kaydeder. Gelen dış kayıtlar `channel_external_refs` üzerinden eşlenir; aynı kayıt iki kez içeri alınmaz, eski sürüm yenisini ezmez.

**Teknoloji:** NestJS, Prisma (tenant eklentisi), PostgreSQL, BullMQ (INF-09), Redis (Lua betikleri), Jest (unit + e2e).

**Kaynak:** `docs/roadmap/TASK_REGISTER.md` → INT-02 satırı ("Aynı sipariş iki kez içeri alınmaz; başarısız iş görünür ve yeniden denenebilir"; test türleri U, E; CRITICAL), `docs/ARCHITECTURE.md` → Entegrasyonlar, `backend/src/queue/*`, `backend/src/channels/*`.

## Genel kısıtlar

- Mod CRITICAL: bağımsız inceleyici diff'i inceler; bulgular kapanmadan `DONE-PR` yok.
- Migration: `database/prisma/migrations/<ts>_sync_engine/{migration.sql,down.sql}`; izole prova (`backup-and-rehearse.sh`) zorunlu; dev DB'ye uygulama ayrı kullanıcı onayı ister.
- Yeni tabloların hepsinde `tenant_id`; tenant Prisma eklentisi dışında kalmaz (`GLOBAL_MODELS`'e eklenmez). `tm_app` yetkileri: `SELECT, INSERT, UPDATE` (silme yok).
- Kuyruk payload'ında, logda, `error_code`'da ve HTTP yanıtında kimlik bilgisi veya serbest hata metni yok; yalnızca kod (`errorCode()` deseni).
- Kullanıcıya dönük metinler Türkçe.
- Gerçek pazaryerine istek yok: testlerde sahte adapter. Trendyol hız sınırı değeri doğrulanmadı → yapılandırılabilir, varsayılan muhafazakâr.
- Yeni kapsam yok: Trendyol'a özgü handler'lar INT-TY-01…03'te; yönetim UI INT-03'te.

## Kabul koşulları (kullanıcı onayı, 2026-11-13)

Uygulama bu oturumda tek geliştirici tarafından yapılır; bitince ayrı bir ajan bağımsız inceleme yapar.

1. Tenant ve kanal hesabı ayrımı tablolarda, kuyruk işlerinde, log listelemede ve yeniden deneme API'sinde korunur. Hassas bilgi loga yazılmaz.
2. Aynı dış kayıt eşzamanlı işlense, iş yeniden denense ya da çalışan işlem ortasında kapansa bile mükerrer kayıt oluşmaz. Bunu veritabanı tekillik kısıtları ve transaction'lar güvenceye alır.
3. Hız sınırı tüm kuyruk çalışanlarında ortaktır (Redis). Trendyol değerleri doğrulanmış platform limiti olarak belgelenmez. Resmî limit doğrulanana kadar canlı çağrı kapalıdır (`SYNC_LIVE_CALLS` varsayılan `false`); geliştirme sahte adapter ile sürer.
4. Geçici hatalar, yetkilendirme hataları ve kalıcı doğrulama hataları ayrı ele alınır. Yeniden denemeler sınırlıdır; 429 yanıtında `Retry-After` varsa dikkate alınır.
5. Başarısız işi yeniden denetme yetki kontrolünden geçer. Çalışan bir iş ikinci kez başlatılamaz: geçiş tek SQL ifadesiyle (`UPDATE … WHERE status = 'failed'`) yapılır.
6. Migration yalnızca izole test veritabanında prova edilir. Eşzamanlılık, mükerrer kayıt, tenant izolasyonu ve hata sonrası toparlanma testleri koşulur. Bağımsız incelemedeki engelleyici bulgular kapanır, sonra PR açılır. Merge, dev migration ve deploy öncesinde sonuçlar kullanıcıya raporlanır.

## İnceleme odağı

1. **Aynı dış sipariş eşzamanlı iki işte gelir** → yalnızca bir yerel kayıt; diğeri `duplicate` sayılır (Görev 2 eşzamanlılık testi).
2. **Kanal hesabı iş sırasında silinir/pasifleşir** → iş `CHANNEL_ACCOUNT_INACTIVE` ile yeniden denenmeden `failed`; kimlik bilgisi çözülmez (Görev 4).
3. **Başka tenant'ın `syncJobId`'si kuyruğa düşer veya API'de istenir** → çalışmaz / 404 (Görev 4, Görev 5).
4. **Uygulama iş ortasında çöker** (`running` satırı kalır) → BullMQ yeniden denediğinde aynı satır `running`'den devam eder, ikinci satır açılmaz (Görev 4 testi: aynı `syncJobId` iki kez çalıştırılır).
5. **Hız sınırı aşılır** → istek pazaryerine gitmez; iş hata sayılmadan geciktirilerek yeniden denenir ve deneme hakkı tükenmez (Görev 3, Görev 4).

---

## Dosya yapısı

| Dosya | Sorumluluk |
|---|---|
| `database/prisma/schema.prisma` | `SyncJob`, `ChannelExternalRef` modelleri |
| `database/prisma/migrations/20261113120000_sync_engine/` | tablolar, indeksler, yetkiler, `down.sql` |
| `backend/src/sync/sync.types.ts` | tür, durum, hata sınıfları, handler arayüzü |
| `backend/src/sync/sync-errors.ts` | hata sınıflandırma (geçici / kalıcı / hız sınırı) |
| `backend/src/sync/channel-rate-limiter.ts` | kanal hesabı başına token bucket (Redis Lua) |
| `backend/src/sync/external-refs.repository.ts` | dış kayıt eşleme + çakışma çözümü |
| `backend/src/sync/sync-jobs.repository.ts` | `sync_jobs` CRUD |
| `backend/src/sync/sync.service.ts` | enqueue, çalıştırma sarmalayıcısı, handler kayıt defteri, retry |
| `backend/src/sync/sync.controller.ts` | log listeleme ve yeniden deneme uçları |
| `backend/src/sync/sync.module.ts` | modül; `ChannelsModule`, `QueueModule`, `RateLimitModule` kullanır |
| `backend/test/sync.e2e-spec.ts`, `backend/test/migration-sync.e2e-spec.ts` | e2e |

---

### Görev 1: Şema ve migration

**Dosyalar:**
- Değiştir: `database/prisma/schema.prisma`
- Oluştur: `database/prisma/migrations/20261113120000_sync_engine/migration.sql`, `down.sql`
- Test: `backend/test/migration-sync.e2e-spec.ts` (desen: `migration-catalog-prices.e2e-spec.ts`)

**Arayüzler:**
- Üretir: Prisma modelleri `SyncJob` (`sync_jobs`), `ChannelExternalRef` (`channel_external_refs`).

`sync_jobs` kolonları: `id uuid pk`, `tenant_id`, `company_id`, `channel_account_id`, `kind varchar(50)`, `status varchar(20)` (`queued|running|succeeded|failed`, CHECK), `idempotency_key varchar(200)`, `payload jsonb` (kimlik bilgisi yok), `attempts int default 0`, `error_code varchar(80) null`, `stats jsonb default '{}'` (`processed`, `created`, `updated`, `skipped`, `conflicts`), `queued_at`, `started_at null`, `finished_at null`, `created_by uuid null`. Tekil: `(tenant_id, channel_account_id, kind, idempotency_key)`. İndeks: `(tenant_id, channel_account_id, status, queued_at desc)`. FK: `(tenant_id, company_id) → companies`, `(tenant_id, channel_account_id) → channel_accounts(tenant_id, id)`, `ON DELETE RESTRICT`.

`channel_external_refs` kolonları: `id`, `tenant_id`, `channel_account_id`, `entity_type varchar(30)` (`order|product|variant`, CHECK), `external_id varchar(100)`, `local_id uuid null`, `external_updated_at timestamptz null`, `payload_hash char(64)`, `last_sync_job_id uuid null`, `created_at`, `updated_at`. Tekil: `(tenant_id, channel_account_id, entity_type, external_id)`.

- [ ] **Adım 1: Başarısız e2e testlerini yaz** — `migration-sync.e2e-spec.ts`: `applies_only_sync_engine_pending`, `unique_idempotency_key_rejects_second_insert` (23505), `unique_external_ref_rejects_second_insert` (23505), `status_check_rejects_unknown` (23514), `tm_app_has_select_insert_update_only` (`has_table_privilege(..., 'DELETE')` = false), `down_sql_reverts_on_empty_tables`.
- [ ] **Adım 2: Koş, başarısız olduğunu gör** — `npm run test:e2e -- migration-sync` → FAIL (tablo yok).
- [ ] **Adım 3: Şema + `migration.sql` + `down.sql` yaz**; `prisma generate`.
- [ ] **Adım 4: Koş** — aynı komut → PASS; `tenant-context.allowlist.spec.ts` PASS (yeni modeller tenant kapsamlı).
- [ ] **Adım 5: Commit** — `feat(sync): sync_jobs and channel_external_refs schema (INT-02)`

### Görev 2: Dış kayıt eşleme ve çakışma çözümü

**Dosyalar:** Oluştur `backend/src/sync/external-refs.repository.ts`; test `backend/src/sync/external-refs.repository.spec.ts` + `backend/test/sync.e2e-spec.ts` (eşzamanlılık).

**Arayüzler:**
- Üretir:
  - `type RefDecision = 'created' | 'updated' | 'unchanged' | 'stale'`
  - `ExternalRefsRepository.claim(input: { channelAccountId: string; entityType: 'order'|'product'|'variant'; externalId: string; externalUpdatedAt: Date | null; payloadHash: string; syncJobId: string }): Promise<{ decision: RefDecision; ref: { id: string; localId: string | null } }>`
  - `ExternalRefsRepository.setLocalId(refId: string, localId: string): Promise<void>`

Kural (tek SQL ifadesi, `INSERT … ON CONFLICT … DO UPDATE … WHERE` ile atomik):
- yoksa → `created`;
- `payload_hash` aynı → `unchanged` (dokunulmaz);
- gelen `externalUpdatedAt` < kayıtlı → `stale` (dokunulmaz);
- aksi → `updated` (hash, zaman, `last_sync_job_id` güncellenir). İkisi de `null` ise hash farkı `updated` sayılır.

- [ ] **Adım 1: Unit testler** — `created_then_unchanged_for_same_hash`, `older_external_updated_at_is_stale`, `newer_hash_is_updated`, `null_timestamps_compare_by_hash`.
- [ ] **Adım 2: E2E eşzamanlılık testi** — `concurrent_claims_create_one_ref`: aynı `externalId` için 10 paralel `claim` → tam 1 `created`, 9 `unchanged`, tabloda 1 satır. Ayrıca `other_tenant_cannot_see_ref`.
- [ ] **Adım 3: Koş → FAIL; uygula; koş → PASS.**
- [ ] **Adım 4: Commit** — `feat(sync): external ref claim with conflict resolution (INT-02)`

### Görev 3: Kanal hız sınırlayıcı ve hata sınıflandırma

**Dosyalar:** Oluştur `channel-rate-limiter.ts`, `sync-errors.ts`; testler `*.spec.ts` yanında.

**Arayüzler:**
- Üretir:
  - `interface ChannelRatePolicy { capacity: number; refillPerSecond: number }`
  - `CHANNEL_RATE_POLICIES: Record<string, ChannelRatePolicy>` — `trendyol` varsayılanı `{ capacity: 10, refillPerSecond: 5 }`, `SYNC_RATE_TRENDYOL="capacity:refill"` ile ezilebilir (değer Trendyol belgesiyle doğrulanmadı; yorumda yazılır).
  - `ChannelRateLimiter.take(channel: string, channelAccountId: string, tokens = 1): Promise<{ ok: true } | { ok: false; retryAfterMs: number }>` — Redis `TIME` kullanan Lua token bucket, anahtar `rl:sync:<channel>:<accountId>`; Redis hatasında `SyncRateLimitUnavailableError` (fail closed).
  - `class RetryLaterError extends Error { code = 'SYNC_RETRY_LATER'; constructor(readonly delayMs: number) }`
  - `class PermanentSyncError extends Error { constructor(readonly code: string) }`
  - `classifyAdapterFailure(error: unknown): 'transient' | 'permanent' | 'rate_limited'` — `ConnectionResult` kodları: `INVALID_CREDENTIALS`, `FORBIDDEN` → permanent; `UNAVAILABLE`, `ETIMEDOUT`, `ECONNRESET`, HTTP 5xx → transient; HTTP 429 → rate_limited; `PermanentSyncError` → permanent; bilinmeyen → transient.

- [ ] **Adım 1: Testler** — limiter (gerçek Redis, e2e değil ama `queue.service.spec.ts` gibi test Redis'i): `allows_capacity_then_refuses_with_retry_after`, `refills_over_time`, `accounts_are_independent`, `redis_down_throws_unavailable`. Sınıflandırma: her kod için tablo testi.
- [ ] **Adım 2: FAIL → uygula → PASS.**
- [ ] **Adım 3: Commit** — `feat(sync): per-account rate limiter and failure classification (INT-02)`

### Görev 4: Senkron servisi (enqueue, çalıştırma, retry)

**Dosyalar:** Oluştur `sync-jobs.repository.ts`, `sync.types.ts`, `sync.service.ts`, `sync.module.ts`; değiştir `backend/src/app.module.ts` (modül kaydı); test `sync.service.spec.ts` + `backend/test/sync.e2e-spec.ts`.

**Arayüzler:**
- Tüketir: `QueueService.register/enqueue/retryDeadLetter`, `defineJob`, `ChannelsService.credentialsFor(companyId, id)`, Görev 2 ve 3.
- Üretir:
  - `type SyncKind = string` (ör. `trendyol.product.push`; ad deseni `defineJob` ile aynı).
  - `interface SyncContext { tenantId: string; companyId: string; channelAccountId: string; channel: string; syncJobId: string; attempt: number; credentials: Readonly<Record<string,string>>; refs: ExternalRefsRepository; takeRate(tokens?: number): Promise<void>; stats: SyncStats }`
  - `type SyncHandler<P> = (payload: P, ctx: SyncContext) => Promise<void>`
  - `SyncService.registerKind<P>(kind: SyncKind, handler: SyncHandler<P>, options?: { attempts?: number; backoffMs?: number; parse?: (raw: unknown) => P }): void` — kind başına bir `defineJob({ name: 'sync.' + kind })`.
  - `SyncService.start(user: AuthUser, input: { companyId: string; channelAccountId: string; kind: SyncKind; payload: unknown; idempotencyKey: string }): Promise<{ syncJobId: string; duplicate: boolean }>`
  - `SyncService.retry(user: AuthUser, companyId: string, syncJobId: string): Promise<void>` — yalnızca `failed`; kalıcı hata koduyla bitmiş işleri de yeniden kuyruğa alır (kullanıcı kimlik bilgisini düzeltmiş olabilir).
  - `SyncService.list(user, companyId, channelAccountId, query: { status?: SyncStatus; limit?: number; cursor?: string })`

Çalıştırma sarmalayıcısı (kuyruk handler'ı) sırası:
1. `sync_jobs` satırını `syncJobId` ile oku; yoksa / tenant farklıysa `PermanentSyncError('SYNC_JOB_NOT_FOUND')`.
2. Kanal hesabı aktif değilse `failed` + `CHANNEL_ACCOUNT_INACTIVE`, kimlik bilgisi çözülmez.
3. `status = running`, `attempts = attempt`, `started_at` (ilk seferde).
4. `credentialsFor`; handler'ı çağır. `ctx.takeRate` limiter reddederse `RetryLaterError(retryAfterMs)` fırlatır.
5. Başarı → `succeeded`, `stats`, `finished_at`.
6. `RetryLaterError` → iş BullMQ `moveToDelayed` ile ertelenir, deneme hakkı tüketilmez (`job.moveToDelayed` + `DelayedError`; INF-09 runner'a gereken küçük genişletme bu görevde, `job-runner.spec.ts`'e test eklenir).
7. permanent → `failed` + kod, `UnrecoverableError`; transient → kod yazılır, son denemede `failed`, aksi halde `queued` kalır ve yeniden fırlatılır.

- [ ] **Adım 1: Unit testler (sahte repo/kuyruk)** — `start_creates_row_and_enqueues_with_same_key`, `start_same_key_returns_duplicate_without_new_row`, `run_success_marks_succeeded_with_stats`, `run_permanent_marks_failed_no_retry`, `run_transient_last_attempt_marks_failed`, `run_inactive_account_fails_without_decrypt`, `run_rate_limited_delays_without_consuming_attempt`, `run_twice_same_id_reuses_row` (çökme sonrası), `error_code_never_contains_message`.
- [ ] **Adım 2: E2E** (`sync.e2e-spec.ts`, gerçek kuyruk + sahte kind `test.echo`): `job_runs_in_its_tenant`, `failed_job_visible_and_retry_succeeds`, `other_tenant_sync_job_id_not_run`.
- [ ] **Adım 3: FAIL → uygula → PASS** — `npm test -- sync`, `npm run test:e2e -- sync`.
- [ ] **Adım 4: Commit** — `feat(sync): sync service with logged, retryable jobs (INT-02)`

### Görev 5: Senkron logu API'si

**Dosyalar:** Oluştur `sync.controller.ts` (desen: `channels.controller.ts`, `@RequirePermissions(MANAGE)` aynı izin); test `sync.e2e-spec.ts`.

Uçlar:
- `GET /api/v1/companies/:companyId/channel-accounts/:accountId/sync-jobs?status=&limit=&cursor=` → `{ data: SyncJobView[], nextCursor }`; `SyncJobView` = `id, kind, status, attempts, errorCode, errorMessage (Türkçe, koddan eşlenir), stats, queuedAt, startedAt, finishedAt`. `payload` dönülmez.
- `POST …/sync-jobs/:syncJobId/retry` → 202; `failed` değilse 409 `SYNC_JOB_NOT_FAILED`.
- Başlatma ucu yok (kind'ler INT-TY-* ile gelir; YAGNI).

- [ ] **Adım 1: E2E testler** — `list_returns_own_jobs_newest_first`, `list_filters_by_status`, `list_has_no_payload_field`, `viewer_role_gets_403`, `other_tenant_account_404`, `retry_failed_202_then_succeeds`, `retry_succeeded_409`.
- [ ] **Adım 2: FAIL → uygula → PASS.**
- [ ] **Adım 3: Commit** — `feat(sync): sync log list and retry endpoints (INT-02)`

### Görev 6: Tam doğrulama, inceleme ve PR

- [ ] backend `npm run lint`, `npm run build`, `npm test`, `npm run test:e2e` → hepsi yeşil (sayılar PR'a yazılır).
- [ ] İzole migration provası: `backup-and-rehearse.sh` → yalnızca `20261113120000_sync_engine` bekliyor, eski satırlar değişmiyor, ikinci deploy no-op, `down.sql` ok.
- [ ] Bağımsız inceleyici (CRITICAL): odak tenant izolasyonu, sır sızıntısı, idempotency/eşzamanlılık, deneme hakkı muhasebesi. Bulgular kapanır.
- [ ] `docs/API_DOCUMENTATION.md` (uçlar), `docs/DATABASE.md` (tablolar), `TASK_REGISTER`/`PROJECT_STATUS` → `DONE-PR`.
- [ ] PR aç. Merge ve dev DB migration'ı kullanıcı onayı bekler.
