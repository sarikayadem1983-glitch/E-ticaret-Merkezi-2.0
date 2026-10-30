# Kullanıcı Yönetimi ve Çoklu Tenant Üyeliği — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Global kullanıcı kimliği + tenant üyeliği, firma başına rol, e-posta daveti ve kullanıcı yönetimi ekranları.

**Architecture:** `users` global olur, `tenant_memberships` kişiyi mağazaya bağlar; Owner/Admin `user_roles` (scope `tenant`), Operasyon/Muhasebe/Görüntüleyici `user_company_roles` (scope `company`) ile atanır. İzinler `roles.catalog.ts`'ten `roles.key` ile çözülür; firma kapsamlı her istek o firmadaki rolü DB'den okur. Oturumlar `auth_version` ile anında geçersizleşir; davetler hash'li tek kullanımlık token ve SMTP (geliştirmede Mailpit) ile çalışır.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Redis, nodemailer, Next.js (App Router) BFF, TanStack Query, Vitest, Playwright, Mailpit.

**Spec:** `docs/superpowers/specs/2026-10-28-user-management-design.md`

## Global Constraints

- **Migration onay kapısı:** Task 1 ve Task 2 migration SQL'ini *yazar ve izole kopyada dener*; geliştirme veritabanına `prisma migrate deploy` **yalnızca kullanıcı "migration onayı" verdikten sonra** çalışır (Task 3). Production'da hiçbir adım çalışmaz.
- **Aşama 2** (`users.tenant_id`, `users.is_active` silme) yalnızca hazırlanır (`database/prisma/migrations-pending/`), uygulanmaz.
- Mevcut kullanıcı, şifre hash'i, rol, firma ataması, refresh token ve audit log satırı silinmez/değişmez.
- Tenant'a ait her sorgu `tenant_id` ile filtrelenir; `User` yalnızca system context'te sorgulanır.
- Davet token'ı: 32 bayt rastgele, yalnızca SHA-256 hex saklanır, TTL `INVITATION_TTL_HOURS` (varsayılan 168), tek kullanımlık.
- Token, davet bağlantısı, şifre, SMTP şifresi asla loglanmaz/audit'e yazılmaz; e-posta logda maskeli (`a***@example.com`).
- Hata biçimi: `{ error: { code, message, details } }`; yeni kodlar: `ALREADY_MEMBER`, `INVITATION_PENDING`, `INVITATION_INVALID`, `INVITATION_EMAIL_MISMATCH`, `SESSION_REVOKED`, `TOKEN_STALE`, `LAST_OWNER`, `ROLE_NOT_GRANTABLE`, `COMPANY_REQUIRED`.
- Erişimi olmayan / başka tenant'a ait kayıt `404` (varlık açığa çıkmaz). Yetki yok `403`.
- Arayüz metni Türkçe; izin listesi kullanıcıya gösterilmez.
- Commit: Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Dal: `feature/user-management`.
- Çalışan Next.js dev sunucusunun üzerinde `next build` çalıştırılmaz (build ayrı kopyada).

## Review Focus

1. **E-posta büyük/küçük harf:** `Ayse@X.com` ile davet, `ayse@x.com` hesabıyla eşleşmeli; login de normalize edilmeli → Task 4 testi `login normalizes email case`.
2. **Eş zamanlı kabul:** aynı token ile iki paralel kabul → yalnızca biri başarılı, diğeri `INVITATION_INVALID` → Task 10 testi `concurrent accept succeeds once`.
3. **Kendi oturumunu kilitleme:** Owner kendini pasife alamaz / son Owner düşürülemez → Task 7 testi `last owner cannot be deactivated or demoted`.
4. **Davet sonrası firma pasife alınırsa:** kabulde pasif firma atlanır; hiç aktif firma kalmazsa `INVITATION_INVALID` → Task 10 testi `accept skips inactive companies`.
5. **Rol değişikliği açık sekmede:** kullanıcı açık oturumdayken rolü düşürülür → sonraki istek eski yetkiyle yazamaz, oturum düşmez (TOKEN_STALE → refresh) → Task 6 ve Task 13 testleri.

---

## Bölüm 1 — Veritabanı ve migration

### Task 1: Aşama 1 migration SQL'i, ön kontroller ve doğrulama sorguları

**Files:**
- Modify: `database/prisma/schema.prisma`
- Create: `database/prisma/migrations/20261029090000_tenant_memberships/migration.sql`
- Create: `database/migrations-verify/20261029090000/snapshot-before.sql`, `verify-after.sql`, `rollback.sql`
- Modify: `database/roles/setup-roles.sql` (tm_app grant'leri: `tenant_memberships`, `invitations` → SELECT/INSERT/UPDATE; DELETE yok)
- Test: `backend/test/migration-phase1.e2e-spec.ts`

**Interfaces:**
- Produces (Prisma modelleri): `TenantMembership { tenantId, userId, status: MembershipStatus, authVersion: Int, joinedAt, deactivatedAt? }`, `Invitation { id, tenantId, email, tenantRoleId?, companyRoles: Json, tokenHash, status: InvitationStatus, expiresAt, invitedByUserId, acceptedByUserId?, acceptedAt?, revokedAt?, lastSentAt?, sendAttempts, lastSendError? }`, `Role.key String?`, `Role.scope RoleScope`, `Role.isSystem Boolean`, `User.lastTenantId?`, `User.emailVerifiedAt?`, `User.tenantId String?`. Enum'lar: `MembershipStatus { active inactive }`, `InvitationStatus { pending accepted revoked }`, `RoleScope { tenant company }`. `AuditAction` ekleri: `INVITATION_CREATED INVITATION_RESENT INVITATION_REVOKED INVITATION_ACCEPTED MEMBERSHIP_CREATED MEMBERSHIP_DEACTIVATED MEMBERSHIP_ACTIVATED ROLE_CHANGED COMPANY_ACCESS_CHANGED TENANT_SWITCH`.

Migration sırası (spec "Migration planı" 1–7 + "Kod kataloğu ile eşleşme"):
1. Ön kontroller, ihlalde `RAISE EXCEPTION`: `lower(email)` çakışması; `user_company_roles`'ta `(tenant_id,user_id,company_id)` tekrarı.
2. Enum'lar, `tenant_memberships` (PK `(tenant_id,user_id)`), backfill `INSERT ... SELECT tenant_id, id, CASE WHEN is_active THEN 'active' ELSE 'inactive' END FROM users`.
3. `roles.key/scope/is_system`; `UPDATE roles SET key='owner', scope='tenant', is_system=true WHERE name='owner'`; kalan satırlar `scope='tenant', is_system=false` (bugün yok; `verify-after.sql` raporlar). Her tenant için eksik `admin`(tenant), `operations`/`accounting`/`viewer`(company) satırları (`permissions` katalog kopyası, `name` Türkçe ad).
4. `users.last_tenant_id = tenant_id`, `email = lower(email)`, `email_verified_at` NULL; `tenant_id` DROP NOT NULL; `users(tenant_id)` FK'si kaldırılır (değerler kalır).
5. `user_roles.role_scope` / `user_company_roles.role_scope` `GENERATED ALWAYS AS ('tenant'/'company') STORED`; `roles` tekil `(tenant_id,id,scope)`; FK `(tenant_id,role_id,role_scope) → roles(tenant_id,id,scope)`; FK `(tenant_id,user_id) → tenant_memberships`; `refresh_tokens` FK aynı şekilde; eski `users` FK'leri kaldırılır. Yeni FK'ler `NOT VALID` eklenip `VALIDATE CONSTRAINT` edilir. `user_company_roles` tekil `(tenant_id,user_id,company_id)`.
6. `invitations` + kısmi tekil `(tenant_id,email) WHERE status='pending'`, tekil `token_hash`.
7. `AuditAction` değerleri, `tm_app` grant'leri (mevcut `app_role_privileges` migration'ının biçimiyle).

`snapshot-before.sql`: `CREATE TABLE _mig_snapshot_* AS` ile `(id,tenant_id,is_active,md5(password_hash))`, `user_roles`, `user_company_roles`, `refresh_tokens(id,tenant_id,user_id)`, `count(*)+md5(string_agg(id::text,'' ORDER BY id))` audit için. `verify-after.sql`: spec "Migration güvenliği" 4'teki her kontrol tek satır `check_name | ok(bool) | detail` döndürür. `rollback.sql`: spec 5'teki adımlar; davetle oluşmuş `tenant_id IS NULL` kullanıcı varsa `RAISE EXCEPTION`.

- [ ] **Step 1: Write the failing test** `migration-phase1.e2e-spec.ts` — boş bir şema (`tm_migration_test`) üzerinde migration'ları `20261028140000_companies`'e kadar uygular, örnek veri ekler (2 tenant; tenant A: owner + pasif kullanıcı `Ayse@Example.com`, firma + `user_company_roles`; refresh token), `snapshot-before.sql`, yeni migration, `verify-after.sql` çalıştırır.

```ts
it('phase 1 keeps every user–tenant–role mapping', async () => {
  const rows = await run('verify-after.sql');
  expect(rows.filter((r) => !r.ok)).toEqual([]);
});
it('creates one membership per user with the same status', async () => {
  expect(await q('select status from tenant_memberships where user_id=$1', [passiveId])).toEqual([{ status: 'inactive' }]);
});
it('stops when two emails differ only by case', async () => {
  await seedDuplicateCaseEmail();
  await expect(applyPhase1()).rejects.toThrow(/email çakışması/);
});
it('rejects an owner role in user_company_roles', async () => {
  await expect(insertCompanyRole(ownerRoleId)).rejects.toThrow(/foreign key/);
});
it('rollback.sql restores the previous schema', async () => {
  await run('rollback.sql');
  expect(await columnNullable('users', 'tenant_id')).toBe(false);
});
```

- [ ] **Step 2:** `cd backend && npx vitest run --config ./vitest.config.e2e.ts test/migration-phase1.e2e-spec.ts` → FAIL (migration dosyası yok).
- [ ] **Step 3:** Şema + `migration.sql` + üç SQL dosyasını yaz. Test, `MIGRATION_DATABASE_URL`'den türetilen ayrı `tm_migration_test` veritabanını oluşturup siler; geliştirme veritabanına dokunmaz.
- [ ] **Step 4:** Aynı komut → PASS. `npx prisma validate --schema ../database/prisma/schema.prisma` → geçerli.
- [ ] **Step 5:** Commit `feat(db): add tenant memberships and invitations phase 1 migration`.

### Task 2: Yedek ve izole prova betiği

**Files:**
- Create: `database/scripts/backup-and-rehearse.sh`
- Create: `database/migrations-pending/phase2_drop_legacy_user_columns/migration.sql` (yalnızca hazırlık, `migrations/` dışında)
- Modify: `docs/DATABASE.md` (yeni tablolar, aşamalar, betik kullanımı)

**Interfaces:**
- Produces: `backup-and-rehearse.sh <out-dir>` → `<out-dir>/ticaret_merkezi-<ts>.dump`, `restore-check.txt`, `rehearsal-verify.txt`; çıkış kodu 0 = tüm kontroller `ok`.

Betik: `docker exec tm-postgres pg_dump -Fc` → `pg_restore --list` → `tm_restore_check`'e geri yükle, tablo satır sayılarını kaynakla karşılaştır → `tm_migration_rehearsal`'a geri yükle → `snapshot-before.sql` → `prisma migrate deploy` (rehearsal URL ile) → `verify-after.sql` → `rollback.sql` provası ikinci bir kopyada. Kaynak veritabanına yalnızca `pg_dump` ile okuma yapar.

- [ ] **Step 1:** Betiği yaz; kaynak DB adını argüman almaz, `.env`'deki `POSTGRES_DB`'den okur ve hedef adların kaynakla aynı olmasını reddeder.
- [ ] **Step 2:** `bash database/scripts/backup-and-rehearse.sh "$SCRATCH/mig"` → `rehearsal-verify.txt` tüm satırlar `ok=t`, çıkış 0. Çıktıyı kullanıcıya rapor için sakla.
- [ ] **Step 3:** Commit `chore(db): add backup, restore check and migration rehearsal script`.

### Task 3: ⛔ Kullanıcı onay kapısı — geliştirme veritabanında Aşama 1

- [ ] **Step 1:** Kullanıcıya Task 2 çıktısını (yedek yolu, restore kontrolü, prova doğrulaması, rollback provası) sun ve "migration onayı" iste. **Onay yoksa dur.**
- [ ] **Step 2:** Onaydan sonra: yeni yedek (`backup-and-rehearse.sh`), `snapshot-before.sql` dev DB'de, `cd backend && npm run prisma:deploy`, `verify-after.sql` → tüm `ok`. Sonucu kullanıcıya bildir.

## Bölüm 2 — Global kullanıcı ve tenant üyeliği

### Task 4: Tenant eklentisi global model kuralı + login/register üyelikle

**Files:**
- Modify: `backend/src/tenancy/tenant-prisma.extension.ts` (+ spec)
- Create: `backend/src/memberships/memberships.repository.ts`, `memberships.module.ts`
- Modify: `backend/src/auth/auth.repository.ts`, `auth.service.ts`, `token.service.ts`, `backend/src/tenancy/tenant-context.allowlist.spec.ts`
- Test: `backend/src/tenancy/tenant-prisma.extension.spec.ts`, `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Produces: `GLOBAL_MODELS = new Set(['User'])` — tenant context'inde `User` işlemi `TenantViolationError`; system context'te filtresiz. `MembershipsRepository.findActiveForUser(userId): Promise<{ tenantId; tenantName; tenantSlug }[]>` (system), `get(tenantId, userId)`. `AccessTokenPayload { sub; tid; perms: string[]; ver: number }`. `AuthService.login` dönüşü değişmez (`TokenPair`).

- [ ] **Step 1: Failing tests**
```ts
it('refuses User queries inside a tenant store', () => {
  expect(asA(() => applyTenantScope('User', 'findMany', {}))).toThrow(TenantViolationError);
});
it('leaves User unscoped in system context', () => {
  expect(asSystem(() => applyTenantScope('User', 'findFirst', { where: { email: 'x' } }))).toEqual({ where: { email: 'x' } });
});
// app.e2e-spec.ts
it('login normalizes email case', async () => { await login('OWNER@Example.com').expect(200); });
it('login picks last_tenant_id among several memberships', async () => { /* iki üyelik, last_tenant_id=B → token.tid=B */ });
it('login with only inactive memberships returns the generic error', async () => { /* 401, message 'Email veya şifre hatalı' */ });
it('register creates user, membership and five system roles', async () => { /* roles count = 5, membership active */ });
```
- [ ] **Step 2:** `cd backend && npm test && npm run test:e2e` → yeni testler FAIL.
- [ ] **Step 3:** Uygula: login global kullanıcıyı system context'te bulur, aktif üyelikleri seçer (spec "Login" 1–3), `ver` ekler; register `createMany` ile 5 sistem rolü + owner üyeliği, transaction `timeout: 15_000`. İzin listesine `memberships/memberships.repository.ts` eklenir.
- [ ] **Step 4:** Tüm backend testleri → PASS (mevcut testler: kullanıcı kurulumları üyeliğe göre güncellenir, davranış testleri silinmez).
- [ ] **Step 5:** Commit `feat(auth): global user identity with tenant memberships`.

### Task 5: Mağaza değiştirme ve üyelik listesi

**Files:**
- Modify: `backend/src/auth/auth.controller.ts`, `auth.service.ts`
- Create: `frontend/src/app/api/session/tenant/route.ts`
- Modify: `frontend/src/server/bff-routes.ts` (`GET auth/memberships`), `frontend/src/server/session.ts`
- Create: `frontend/src/components/shell/tenant-selector.tsx`; Modify: `frontend/src/app/(app)/layout.tsx`
- Test: `backend/test/app.e2e-spec.ts`, `frontend/src/server/bff-routes.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/auth/memberships` → `{ data: { tenantId, name, slug, current: boolean }[] }`. `POST /api/v1/auth/switch-tenant { tenantId, refreshToken }` → `TokenPair`; hedef üyelik aktif değil/yok → `404`. BFF `POST /api/session/tenant { tenantId }` → `204`, yeni session id cookie. `switchSession(tokens, client)` in `session.ts` (eski sid'i siler, `selectedCompanyId` sıfır).

- [ ] **Step 1: Failing tests**
```ts
it('switch-tenant issues tokens for the target membership only', async () => { /* tid=B, perms B'nin rolünden */ });
it('switch-tenant to a tenant without active membership is 404', async () => {});
it('switch-tenant revokes the old refresh token', async () => { /* eski refresh → 401 */ });
it('audits TENANT_SWITCH in both tenants', async () => {});
```
- [ ] **Step 2–4:** FAIL → uygula → PASS (`npm run test:e2e`, `cd frontend && npm test`).
- [ ] **Step 5:** Commit `feat(auth): switch active tenant with a fresh session`.

### Task 6: `auth_version` ile oturum geçersizleştirme

**Files:**
- Modify: `backend/src/auth/guards.ts` (`JwtAuthGuard`), `backend/src/auth/auth.service.ts` (refresh: `ver`)
- Modify: `frontend/src/app/api/bff/[...path]/route.ts`, `frontend/src/server/session-manager.ts`
- Test: `backend/test/app.e2e-spec.ts`, `frontend/src/server/session-manager.test.ts`

**Interfaces:**
- Consumes: `MembershipsRepository.get`.
- Produces: `MembershipsRepository.bumpAuthVersion(tx, tenantId, userId): Promise<void>`. Guard hata kodları: üyelik aktif değil → `401 SESSION_REVOKED`; `payload.ver !== membership.authVersion` → `401 TOKEN_STALE`. BFF: `TOKEN_STALE` → `SessionManager.forceRefresh(sid)` + isteği bir kez tekrar; `SESSION_REVOKED` veya ikinci 401 → oturumu sil, `401`.

- [ ] **Step 1: Failing tests**
```ts
it('a deactivated membership is rejected on the next request', async () => { /* deactivate → aynı access token GET /companies → 401 SESSION_REVOKED */ });
it('a stale token version gets TOKEN_STALE and refresh yields the new perms', async () => {});
// session-manager.test.ts
it('retries once after TOKEN_STALE and keeps the session', async () => {});
it('destroys the session on SESSION_REVOKED', async () => {});
```
- [ ] **Step 2–4:** FAIL → uygula → PASS.
- [ ] **Step 5:** Commit `feat(auth): revoke sessions instantly with membership auth_version`.

## Bölüm 3 — Rol ve firma yetkilendirmesi

### Task 7: Rol kataloğu, erişim servisi ve kurallar

**Files:**
- Create: `backend/src/access/roles.catalog.ts`, `access.service.ts`, `access.rules.ts`, `access.module.ts`, `access.rules.spec.ts`, `roles.catalog.spec.ts`
- Modify: `backend/src/auth/auth.repository.ts` (`findPermissions` katalogdan), `backend/src/main.ts` veya `app.module.ts` (açılışta eksik sistem rolü kontrolü, yalnızca log)

**Interfaces:**
- Produces:
  - `type RoleKey = 'owner' | 'admin' | 'operations' | 'accounting' | 'viewer'`; `ROLE_CATALOG: Record<RoleKey, { scope: 'tenant' | 'company'; name: string; permissions: readonly string[] }>` — izinler spec matrisi: owner `['*']`; admin `companies:read, companies:write, companies:all, users:read, users:invite, users:manage, audit:read`; operations/accounting/viewer `companies:read`.
  - `AccessService.tenantPermissions(tenantId, userId): Promise<string[]>` (mağaza rolü ∪ firma rolleri; JWT `perms`).
  - `AccessService.companyRole(userId, companyId): Promise<RoleKey | null>` (tenant context; mağaza rolü varsa `'owner'|'admin'`).
  - `AccessService.assertCompanyPermission(user: AuthUser, companyId: string, permission: string): Promise<void>` — ataması yok → `NotFoundException`; o firmadaki rol izni yoksa → `ForbiddenException`.
  - `access.rules.ts`: `canGrant(actor: RoleKey, target: RoleKey): boolean`; `assertNotLastOwner(...)`; `assertNotSelf(actorId, targetId)`.

- [ ] **Step 1: Failing tests**
```ts
it('company roles never contain tenant-wide permissions', () => {
  for (const k of ['operations','accounting','viewer'] as const)
    expect(ROLE_CATALOG[k].permissions.some((p) => /^(users:|audit:|companies:all)/.test(p))).toBe(false);
});
it('admin can grant company roles but not admin or owner', () => {
  expect(canGrant('admin','viewer')).toBe(true);
  expect(canGrant('admin','admin')).toBe(false);
  expect(canGrant('owner','admin')).toBe(true);
  expect(canGrant('owner','owner')).toBe(false);
});
it('last owner cannot be deactivated or demoted', () => {});
```
- [ ] **Step 2–4:** FAIL → uygula → PASS.
- [ ] **Step 5:** Commit `feat(access): role catalog and grant rules`.

### Task 8: Companies modülünü firma başına role bağla

**Files:**
- Modify: `backend/src/companies/companies.service.ts:38-110`, `companies.repository.ts`, `companies.controller.ts`
- Test: `backend/test/companies.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessService.assertCompanyPermission`, `companyRole`.
- Produces: `PATCH /companies/:id`, `/deactivate`, `/activate` her istekte `assertCompanyPermission(user, id, 'companies:write')`. Liste/özet: mağaza rolü varsa tümü, yoksa yalnızca `user_company_roles` firmaları. `GET /auth/me` ekleri: `{ canManageUsers: boolean, companyCapabilities: Record<companyId, { canWrite: boolean }> }`.

- [ ] **Step 1: Failing tests**
```ts
it('a role in company A gives no access to company B', async () => { /* GET /companies/B → 404 */ });
it('a company role can read its company but cannot write it', async () => { /* accounting in A: GET A 200, PATCH A 403 */ });
it('admin can write every company', async () => {});
it('removing the company role blocks access with the old token', async () => { /* PUT access → eski token GET A → 401 TOKEN_STALE; refresh sonrası 404 */ });
```
- [ ] **Step 2–4:** FAIL → uygula → PASS.
- [ ] **Step 5:** Commit `feat(companies): enforce per-company roles on every request`.

## Bölüm 4 — E-posta davet sistemi

### Task 9: Mail modülü ve Mailpit

**Files:**
- Create: `backend/src/mail/mail.module.ts`, `mail.service.ts`, `mail.config.ts`, `smtp.transport.ts`, `log.transport.ts`, `templates/invitation.ts`, `mail.config.spec.ts`, `invitation.template.spec.ts`
- Modify: `docker/docker-compose.yml` (`mailpit`: `axllent/mailpit:v1.21`, `1025` SMTP, `8025` UI/API, yalnızca `127.0.0.1`), `.env.example`, `backend/package.json` (`nodemailer`)

**Interfaces:**
- Produces: `MailService.send(msg: { to: string; subject: string; html: string; text: string }): Promise<void>` (10 sn zaman aşımı, hata → `MailDeliveryError` kod `SMTP_TIMEOUT|SMTP_REJECTED|SMTP_UNAVAILABLE`). `renderInvitation({ tenantName, inviterName, roleSummary, url, expiresAt }): { subject; html; text }`. Env: `MAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `INVITATION_TTL_HOURS`.

- [ ] **Step 1: Failing tests**
```ts
it('rejects MAIL_TRANSPORT=log in production', () => { expect(() => mailConfig({ NODE_ENV:'production', MAIL_TRANSPORT:'log' })).toThrow(); });
it('requires TLS in production', () => {});
it('escapes tenant and inviter names in HTML', () => {
  expect(renderInvitation({ tenantName: '<script>x</script>', ... }).html).not.toContain('<script>');
});
it('never logs the invitation URL', async () => { /* log transport çıktısında token yok */ });
```
- [ ] **Step 2–4:** FAIL → uygula → PASS. `docker compose -f docker/docker-compose.yml up -d mailpit` → `curl -s localhost:8025/api/v1/info` 200.
- [ ] **Step 5:** Commit `feat(mail): configurable SMTP mail service with Mailpit for dev`.

### Task 10: Davet servisi (oluştur, yeniden gönder, iptal, lookup, kabul)

**Files:**
- Create: `backend/src/invitations/invitations.module.ts`, `invitations.controller.ts`, `invitations.service.ts`, `invitations.repository.ts`, `invitations.dto.ts`, `invitation-token.ts`
- Modify: `backend/src/tenancy/tenant-context.allowlist.spec.ts` (`invitations/invitations.service.ts`), `backend/src/rate-limit/rate-limit.config.ts`
- Test: `backend/test/invitations.e2e-spec.ts`

**Interfaces:**
- Consumes: `MailService`, `AccessService`, `access.rules`, `MembershipsRepository`, `AuditService.record`.
- Produces (REST, `/api/v1`): `POST /invitations` (`CreateInvitationDto = { email } & ({ tenantRole: 'admin' } | { companyRoles: { companyId: string; roleKey: 'operations'|'accounting'|'viewer' }[] })`) → `201 { data: { id, status, delivery: 'sent'|'failed', replacesInactiveMembership: boolean } }`; `GET /invitations?status=`; `POST /invitations/:id/resend`; `POST /invitations/:id/revoke`; `POST /invitations/lookup { token }` → `{ tenantName, inviterName, roleSummary, maskedEmail, accountExists, replacesInactiveMembership }`; `POST /invitations/accept { token, name?, password }`; `POST /invitations/accept-as-current { token }` (JWT). Kabul sonrası yanıt: `{ data: { tenantId, tenantName } }` — **token çifti dönmez, mağaza değiştirmez**.
- `invitation-token.ts`: `newInvitationToken(): { token: string; hash: string }`, `hashInvitationToken(token): string`.
- Hız sınırları: lookup/accept IP başına 10/dk; resend davet başına 1/dk, tenant başına 50/saat.

- [ ] **Step 1: Failing tests** (her biri ayrı `it`)
  - `stores only the token hash` (DB'de token düz metni yok)
  - `email failure keeps the invitation pending with delivery failed` (SMTP kapalı fixture)
  - `resend invalidates the previous link`
  - `revoked, expired and used tokens all return INVITATION_INVALID`
  - `concurrent accept succeeds once`
  - `accept re-checks the inviter's current rights` (davet eden pasif → `INVITATION_INVALID`)
  - `accept skips inactive companies` / tüm firmalar pasif → `INVITATION_INVALID`
  - `accept-as-current requires the exact invited email` (farklı e-posta → `403 INVITATION_EMAIL_MISMATCH`)
  - `existing account needs token and password` (yanlış şifre → `401`, davet `pending` kalır)
  - `accept sets email_verified_at`
  - `accept grants nothing before commit` (transaction içinde hata enjekte → üyelik/rol yok)
  - `inactive membership: old assignments are replaced` + `replacesInactiveMembership: true`
  - `admin cannot invite an admin` → `403 ROLE_NOT_GRANTABLE`; `company roles need at least one company` → `400 COMPANY_REQUIRED`
  - `never reveals whether an email exists in another tenant` (diğer tenant'taki e-postaya davet → normal `201`, yanıt aynı biçim)
  - `accept does not return tokens or switch tenant`
- [ ] **Step 2–4:** FAIL → uygula (kabul: spec "Kabul" 1–5; tek transaction, `updateMany` ile koşullu durum geçişi) → PASS. Mailpit testleri `MAILPIT_URL` ile bağlantıyı `/api/v1/messages`'tan okur.
- [ ] **Step 5:** Commit `feat(invitations): email invitations with hashed single-use tokens`.

## Bölüm 5 — Kullanıcı yönetimi API'leri

### Task 11: Users modülü (liste, erişim düzenleme, pasife alma)

**Files:**
- Create: `backend/src/users/users.module.ts`, `users.controller.ts`, `users.service.ts`, `users.repository.ts`, `users.dto.ts`
- Modify: `docs/API_DOCUMENTATION.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`
- Test: `backend/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `AccessService`, `access.rules`, `MembershipsRepository.bumpAuthVersion`, `AuditService.record`.
- Produces: `GET /users` → `{ data: { userId, name, email, status, lastLoginAt, access: { tenantRole: 'owner'|'admin' } | { companyRoles: { companyId, companyName, roleKey }[] } }[] }`; `GET /users/:userId`; `PUT /users/:userId/access` (body = `CreateInvitationDto` erişim kısmı); `POST /users/:userId/deactivate`, `/activate`. Audit: `ROLE_CHANGED { before, after }`, `COMPANY_ACCESS_CHANGED { added, removed }`, `MEMBERSHIP_DEACTIVATED|ACTIVATED`. Her değişiklikte `bumpAuthVersion`; pasife almada ayrıca refresh token'lar iptal.

- [ ] **Step 1: Failing tests**
  - `lists only members of the current tenant`
  - `a member of another tenant is 404`
  - `deactivate keeps assignments and kills sessions` (sonraki istek `SESSION_REVOKED`, refresh `401`, `user_company_roles` satırları duruyor)
  - `activate requires users:manage and a fresh login` (eski refresh `401`)
  - `admin cannot change an owner or another admin`; `nobody can change their own access`
  - `switching from admin to company roles requires a company`
  - `audit records before/after without secrets`
- [ ] **Step 2–4:** FAIL → uygula → PASS. Dokümanları güncelle.
- [ ] **Step 5:** Commit `feat(users): member list, access editing and deactivation`.

#### USR-T11a (MVP dilimi) — güncelleme 2026-10-30

Kapsam: `GET /users`, `PUT /users/:userId/access`, `POST /users/:userId/deactivate`, `/activate`. `GET /users/:userId` ve `lastLoginAt` T11b'ye kalır. Migration yok (`tm_app`: `user_roles`/`user_company_roles` üzerinde DELETE var, `tenant_memberships` yalnızca UPDATE).

**Owner politikası (kullanıcı kararı 2026-10-30):** owner'ın rolü ve erişimi `PUT /access` ile değiştirilemez (`403 OWNER_IMMUTABLE`); owner son aktif owner değilse pasife alınabilir; sahiplik devri ayrı görev (USR-21). Son owner koruması eşzamanlı isteklerde de geçerli: owner üyelikleri işlem içinde `FOR UPDATE` ile kilitlenir, sayım kilitten sonra yapılır.

**Modül sınırları:** `users` modülü tablo sahibi değildir. `MembershipsRepository` (`listForTenant`, `lockForUpdate`, `setStatus`), `AccessService` (`rolesForUsers`, `replaceAccess`, owner kimlikleri), `AccountsService` (`profiles`, `revokeRefreshTokensInTenant`), `CompaniesService.activeByIds`, `AuditService.record` üzerinden çalışır.

**Kritik senaryolar:** yetki yükseltme (admin → owner/admin ataması, JWT'deki eski izin), başka tenant'ın üyesi/firması, numaralandırma (üye değil = başka tenant = `404`), eşzamanlı iki owner pasife alma, pasife alma ile eşzamanlı refresh/mağaza değiştirme, audit'te sır, kısmi rol değişikliği (tek işlem).

**Başarısız testler (önce yazılır):**
- `lists only members of the current tenant` (ad, e-posta, durum, erişim; firma adı dahil)
- `a member of another tenant is 404` (GET listesinde yok; PUT/deactivate/activate `404`)
- `requires users:read / users:manage` (operations/viewer `403`)
- `deactivate keeps assignments and kills sessions` (sonraki istek `SESSION_REVOKED`, refresh `401`, `user_company_roles` duruyor; kullanıcının diğer mağazadaki oturumu çalışır)
- `activate restores access and requires a fresh login` (eski refresh `401`, yeni login çalışır, eski firmalar geri)
- `nobody changes their own access or deactivates themselves` (`403 SELF_CHANGE`)
- `owner access is immutable` (owner hedefli `PUT /access` `403 OWNER_IMMUTABLE`, owner tarafından bile)
- `admin cannot change an owner or another admin` (`403`); `only an owner grants or removes admin`
- `a non-last owner can be deactivated by another owner; the last active owner cannot` (`409 LAST_OWNER`)
- `concurrent deactivation of the two owners leaves one active owner` (paralel iki istek: biri `200`, diğeri `409`)
- `company roles must name active companies of this tenant` (boş liste, pasif firma, başka tenant'ın firması `422`)
- `switching from admin to company roles` (admin → firma rolleri; eski izinler sonraki istekte `TOKEN_STALE`)
- `audit records before/after without secrets` (`ROLE_CHANGED`, `COMPANY_ACCESS_CHANGED`, `MEMBERSHIP_DEACTIVATED`/`ACTIVATED`; token/hash yok)

**Kapanış:** CRITICAL bağımsız güvenlik incelemesi (ayrı ajan) bulguları kapatılmadan `DONE-PR` olmaz; PR o zamana kadar draft kalır.

## Bölüm 6 — Next.js kullanıcı yönetimi ekranları

### Task 12: BFF route'ları

**Files:**
- Modify: `frontend/src/server/bff-routes.ts` (+ test): `GET users`, `GET users/:uuid`, `PUT users/:uuid/access`, `POST users/:uuid/(de)?activate`, `GET invitations` (query `status`), `POST invitations`, `POST invitations/:uuid/(resend|revoke)`; `PUT` metodunu `[...path]/route.ts` export'una ekle.
- Create: `frontend/src/app/api/invitations/lookup/route.ts`, `accept/route.ts` (oturumsuz, `checkCsrf`, `readJsonBody`; açık oturum varsa `accept-as-current` çağrılır), `frontend/next.config.ts` (`/invite/:path*` için `Referrer-Policy: no-referrer`)
- Test: `frontend/src/server/bff-routes.test.ts`

- [ ] **Step 1: Failing tests** `allows the user management routes`, `still refuses invitations/lookup through /api/bff` (oturumsuz route'lar ayrı), `refuses PUT on routes without a body flag`.
- [ ] **Step 2–4:** FAIL → uygula → PASS.
- [ ] **Step 5:** Commit `feat(bff): allowlist user management and invitation routes`.

### Task 13: Kullanıcılar sayfası, davet diyaloğu, davet kabul sayfası

**Files:**
- Create: `frontend/src/app/(app)/users/page.tsx`, `frontend/src/components/users/invite-dialog.tsx`, `access-editor.tsx`, `members-table.tsx`, `pending-invitations.tsx`
- Create: `frontend/src/app/invite/[token]/page.tsx`
- Modify: `frontend/src/components/shell/sidebar-nav.tsx` (`canManageUsers` ise "Kullanıcılar"), `frontend/src/hooks/queries.ts`, `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: Task 8 `auth/me` bayrakları, Task 10/11 REST biçimleri.
- Produces: `access-editor.tsx` → `AccessValue = { tenantRole: 'admin' } | { companyRoles: { companyId; roleKey }[] }`; "Admin" anahtarı ya da en az bir "Firma + Rol" satırı (satır ekle/çıkar). Davet kabul sayfası durumları: `loading | invalid | newAccount | existingAccount | signedInSameEmail | signedInOtherEmail | done`. `done`: "X mağazasına katıldınız" + "X mağazasına geç" (`POST /api/session/tenant`) + "Şimdilik kalsın".

Metinler: pasif üyelik uyarısı "Bu kişinin bu mağazadaki eski rol ve firma erişimleri bu davettekilerle değiştirilecek."; gönderim hatası "E-posta gönderilemedi. Yeniden gönderin."; geçersiz davet "Bu davet bağlantısı geçersiz veya süresi dolmuş."

- [ ] **Step 1:** Bileşen birim testi yoksa (mevcut düzen), davranış Task 15 Playwright testleriyle doğrulanır; `npm run lint && npm run typecheck` → PASS.
- [ ] **Step 2:** Commit `feat(frontend): users page, invite dialog and invitation acceptance`.

## Bölüm 7 — Güvenlik testleri

### Task 14: Yetki yükseltme ve tenant izolasyonu paketi

**Files:**
- Create: `backend/test/privilege-escalation.e2e-spec.ts`

Spec "Yetki yükseltme testleri" maddeleri, her biri ayrı `it`:
- `company role cannot call users or invitations endpoints` → `403`
- `admin cannot grant admin or owner`; `nobody can edit their own access`
- `foreign tenant company or role ids in invite/access are 404`
- `old token after role removal cannot write` (`TOKEN_STALE`, refresh sonrası yetki yok)
- `inactive membership cannot switch-tenant` → `404`
- `tenant B cannot read A's users, invitations or memberships` → `404`
- `User model is unreachable from tenant context` (ham repo çağrısı → `TenantViolationError`)
- `audit:read is denied to every company role`

- [ ] **Step 1–3:** Yaz → çalıştır (`npm run test:e2e -- privilege-escalation`) → tümü PASS (Task 4–11 doğru ise). Başarısız olan gerçek açık olarak ilgili task'a geri döner.
- [ ] **Step 4:** Commit `test(security): privilege escalation and tenant isolation suite`.

## Bölüm 8 — E2E testleri

### Task 15: Playwright akışları

**Files:**
- Create: `frontend/e2e/users.spec.ts`; Modify: `frontend/e2e/helpers.ts` (`readInviteLinkFromMailpit(email): Promise<string>`), `frontend/e2e/mobile.spec.ts`

Testler:
- `owner invites an accountant for company A; the invitee sees only A`
- `existing user of another store accepts and switches only when asked`
- `revoked invitation link shows the invalid page`
- `deactivated user is signed out on the next action`
- `role change in an open tab takes effect without signing out`
- `mobile: users list renders as cards`

- [ ] **Step 1–3:** Yaz → `npx playwright test` (dev sunucusu temiz başlatılmış, Mailpit açık) → 2 ardışık koşuda tümü PASS.
- [ ] **Step 4:** Commit `test(e2e): invitation, access and tenant switch flows`.

## Bölüm 9 — GitHub PR süreci

### Task 16: Doğrulama ve PR

- [ ] **Step 1:** Tam doğrulama: backend `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build`; frontend `npm test`, `npm run lint`, `npm run typecheck`, ayrı kopyada `next build`, Playwright 2 koşu. Sonuçları kaydet.
- [ ] **Step 2:** `git status` ve `git diff origin/main --stat` ile `.env`, dump dosyası, gizli bilgi olmadığını kontrol et (`*.dump` `.gitignore`'a).
- [ ] **Step 3:** `git push -u origin feature/user-management`; `gh pr view` yoksa `gh pr create --base main` (testlerden biri başarısızsa `--draft`). Açıklama: değişiklik özeti, migration doğrulama çıktısı, test sonuçları (geçen/toplam), Kalan riskler, Aşama 2'nin uygulanmadığı notu.
- [ ] **Step 4:** PR bağlantısını ve sonuçları kullanıcıya bildir. **Merge yok**; Aşama 2 için ayrı onay iste.
