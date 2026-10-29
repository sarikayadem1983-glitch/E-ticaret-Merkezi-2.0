-- User management, phase 1 (additive, reversible): global users + tenant memberships.
-- Spec: docs/superpowers/specs/2026-10-28-user-management-design.md ("Migration planı", "Migration güvenliği").
-- Runs as one transaction: any RAISE EXCEPTION below rolls back every change.
-- Before: database/migrations-verify/20261029090000/snapshot-before.sql. After: verify-after.sql.
-- Undo: rollback.sql in the same folder. users.tenant_id and users.is_active are kept (dropped in phase 2).

-- 1. Pre-checks -------------------------------------------------------------

DO $$
DECLARE detail text;
BEGIN
  SELECT string_agg(e, ', ') INTO detail FROM (
    SELECT lower(email) AS e FROM users GROUP BY lower(email) HAVING count(*) > 1 ORDER BY 1
  ) d;
  IF detail IS NOT NULL THEN
    RAISE EXCEPTION 'email çakışması (yalnızca büyük/küçük harf farkı): %', detail;
  END IF;

  SELECT string_agg(format('%s/%s/%s', tenant_id, user_id, company_id), ', ') INTO detail FROM (
    SELECT tenant_id, user_id, company_id FROM user_company_roles
    GROUP BY 1, 2, 3 HAVING count(*) > 1
  ) d;
  IF detail IS NOT NULL THEN
    RAISE EXCEPTION 'aynı firmada birden fazla rol (tenant/kullanıcı/firma): %', detail;
  END IF;
END $$;

-- 2. Memberships --------------------------------------------------------------

CREATE TYPE "membership_status" AS ENUM ('active', 'inactive');
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'revoked');
CREATE TYPE "role_scope" AS ENUM ('tenant', 'company');

CREATE TABLE "tenant_memberships" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "auth_version" INTEGER NOT NULL DEFAULT 1,
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("tenant_id", "user_id")
);

CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "status", "joined_at", "deactivated_at", "created_at", "updated_at")
SELECT "tenant_id", "id",
       CASE WHEN "is_active" THEN 'active' ELSE 'inactive' END::"membership_status",
       "created_at",
       CASE WHEN "is_active" THEN NULL ELSE "updated_at" END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users";

-- 3. Roles: key / scope / is_system and the five system roles per tenant -------

ALTER TABLE "roles"
  ADD COLUMN "key" TEXT,
  ADD COLUMN "scope" "role_scope" NOT NULL DEFAULT 'tenant',
  ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "roles" ALTER COLUMN "scope" DROP DEFAULT;

-- Existing rows whose name is exactly a catalog key become that system role
-- (today only 'owner' exists). Every other row stays scope='tenant', is_system=false
-- and is reported by verify-after.sql.
UPDATE "roles" r
SET "key" = c.key, "scope" = c.scope::"role_scope", "is_system" = true
FROM (VALUES ('owner', 'tenant'), ('admin', 'tenant'), ('operations', 'company'),
             ('accounting', 'company'), ('viewer', 'company')) AS c(key, scope)
WHERE r."name" = c.key;

CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key") WHERE "key" IS NOT NULL;
CREATE UNIQUE INDEX "roles_tenant_id_id_scope_key" ON "roles"("tenant_id", "id", "scope");

-- Copy of backend/src/access/roles.catalog.ts (informational; permissions are read from the catalog).
INSERT INTO "roles" ("id", "tenant_id", "name", "permissions", "key", "scope", "is_system", "created_at", "updated_at")
SELECT gen_random_uuid(), t."id", c.name, c.permissions, c.key, c.scope::"role_scope", true,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('owner', 'tenant', 'owner', ARRAY['*']),
  ('admin', 'tenant', 'Admin', ARRAY['companies:read', 'companies:write', 'companies:all',
                                     'users:read', 'users:invite', 'users:manage', 'audit:read']),
  ('operations', 'company', 'Operasyon', ARRAY['companies:read']),
  ('accounting', 'company', 'Muhasebe', ARRAY['companies:read']),
  ('viewer', 'company', 'Görüntüleyici', ARRAY['companies:read'])
) AS c(key, scope, name, permissions)
WHERE NOT EXISTS (SELECT 1 FROM "roles" r WHERE r."tenant_id" = t."id" AND r."key" = c.key);

-- Clear message before the FK validation below would fail on the same rows.
DO $$
DECLARE detail text;
BEGIN
  SELECT string_agg(DISTINCT r."name", ', ') INTO detail
  FROM "user_company_roles" ucr JOIN "roles" r ON r."id" = ucr."role_id"
  WHERE r."scope" <> 'company';
  IF detail IS NOT NULL THEN
    RAISE EXCEPTION 'user_company_roles firma kapsamlı olmayan role bağlı: %', detail;
  END IF;
  SELECT string_agg(DISTINCT r."name", ', ') INTO detail
  FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
  WHERE r."scope" <> 'tenant';
  IF detail IS NOT NULL THEN
    RAISE EXCEPTION 'user_roles mağaza kapsamlı olmayan role bağlı: %', detail;
  END IF;
END $$;

-- 4. Users become global identities (tenant_id / is_active stay until phase 2) --

ALTER TABLE "users"
  ADD COLUMN "last_tenant_id" UUID,
  ADD COLUMN "email_verified_at" TIMESTAMPTZ;

UPDATE "users" SET "last_tenant_id" = "tenant_id", "email" = lower("email");

ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_id_fkey";

-- 5. Assignments and refresh tokens hang off the membership ---------------------

ALTER TABLE "user_roles"
  ADD COLUMN "role_scope" "role_scope" GENERATED ALWAYS AS ('tenant'::"role_scope") STORED;
ALTER TABLE "user_company_roles"
  ADD COLUMN "role_scope" "role_scope" GENERATED ALWAYS AS ('company'::"role_scope") STORED;

ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_user_id_company_id_key"
  UNIQUE ("tenant_id", "user_id", "company_id");

ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_tenant_id_user_id_fkey";
ALTER TABLE "user_company_roles" DROP CONSTRAINT "user_company_roles_tenant_id_user_id_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey";

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
-- Generated columns cannot take ON UPDATE CASCADE; role ids never change.
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_role_id_role_scope_fkey"
  FOREIGN KEY ("tenant_id", "role_id", "role_scope") REFERENCES "roles"("tenant_id", "id", "scope")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_role_id_role_scope_fkey"
  FOREIGN KEY ("tenant_id", "role_id", "role_scope") REFERENCES "roles"("tenant_id", "id", "scope")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;

ALTER TABLE "user_roles" VALIDATE CONSTRAINT "user_roles_tenant_id_user_id_fkey";
ALTER TABLE "user_company_roles" VALIDATE CONSTRAINT "user_company_roles_tenant_id_user_id_fkey";
ALTER TABLE "refresh_tokens" VALIDATE CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey";
ALTER TABLE "user_roles" VALIDATE CONSTRAINT "user_roles_tenant_id_role_id_role_scope_fkey";
ALTER TABLE "user_company_roles" VALIDATE CONSTRAINT "user_company_roles_tenant_id_role_id_role_scope_fkey";

-- 6. Invitations ------------------------------------------------------------------

CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tenant_role_id" UUID,
    "company_roles" JSONB NOT NULL DEFAULT '[]',
    "token_hash" TEXT NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "last_sent_at" TIMESTAMPTZ,
    "send_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_send_error" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_email_lowercase" CHECK ("email" = lower("email"))
);

CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE UNIQUE INDEX "invitations_tenant_id_id_key" ON "invitations"("tenant_id", "id");
CREATE UNIQUE INDEX "invitations_tenant_id_email_pending_key" ON "invitations"("tenant_id", "email")
  WHERE "status" = 'pending';
CREATE INDEX "invitations_tenant_id_status_idx" ON "invitations"("tenant_id", "status");

ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenant_role_id_fkey"
  FOREIGN KEY ("tenant_id", "tenant_role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_invited_by_user_id_fkey"
  FOREIGN KEY ("tenant_id", "invited_by_user_id") REFERENCES "tenant_memberships"("tenant_id", "user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_fkey"
  FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Audit actions and application role privileges ---------------------------------
-- IF NOT EXISTS: rollback.sql cannot remove enum values, so a re-apply after rollback must not fail here.

ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'INVITATION_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'INVITATION_RESENT';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'INVITATION_REVOKED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'INVITATION_ACCEPTED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MEMBERSHIP_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MEMBERSHIP_DEACTIVATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'MEMBERSHIP_ACTIVATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'ROLE_CHANGED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'COMPANY_ACCESS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'TENANT_SWITCH';

-- Memberships and invitations are never deleted: deactivate / revoke instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON "tenant_memberships", "invitations" FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON "tenant_memberships", "invitations" TO tm_app;
  END IF;
END $$;
