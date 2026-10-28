-- Manual rollback of migration 20261029090000_tenant_memberships (spec "Migration güvenliği" 5).
-- Run as tm_migrator, only on an isolated copy first. One transaction: stops on the first error.
-- Not restored (by design): original e-mail letter case (emails stay lowercased) and the added
-- audit_action enum values (Postgres cannot drop enum values; unused values are harmless).

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM users WHERE tenant_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback durdu: tenant_id olmayan (davetle oluşmuş) % kullanıcı var', n;
  END IF;
  SELECT count(*) INTO n FROM tenant_memberships m JOIN users u ON u.id = m.user_id
  WHERE m.tenant_id <> u.tenant_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback durdu: kullanıcının kendi tenant''ı dışında % üyelik var (birden fazla tenant)', n;
  END IF;
  -- users.is_active is rebuilt from the single membership, so every user needs exactly one.
  SELECT count(*) INTO n FROM users u
  WHERE (SELECT count(*) FROM tenant_memberships m WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id) <> 1;
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback durdu: kendi tenant''ında tam bir üyeliği olmayan % kullanıcı var', n;
  END IF;
  SELECT count(*) INTO n FROM roles r
  WHERE r.is_system AND r.key IN ('admin', 'operations', 'accounting', 'viewer') AND r.name <> r.key
    AND (EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id)
      OR EXISTS (SELECT 1 FROM user_company_roles ucr WHERE ucr.role_id = r.id));
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback durdu: migration ile eklenen % sistem rolü kullanımda', n;
  END IF;
END $$;

DROP TABLE "invitations";

-- Assignments and refresh tokens go back to users(tenant_id, id).
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_tenant_id_role_id_role_scope_fkey";
ALTER TABLE "user_company_roles" DROP CONSTRAINT "user_company_roles_tenant_id_role_id_role_scope_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_tenant_id_user_id_fkey";
ALTER TABLE "user_company_roles" DROP CONSTRAINT "user_company_roles_tenant_id_user_id_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey";
ALTER TABLE "user_company_roles" DROP CONSTRAINT "user_company_roles_tenant_id_user_id_company_id_key";
ALTER TABLE "user_roles" DROP COLUMN "role_scope";
ALTER TABLE "user_company_roles" DROP COLUMN "role_scope";

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Users: tenant_id back to NOT NULL with its FK (values were never removed).
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" DROP COLUMN "last_tenant_id", DROP COLUMN "email_verified_at";

-- Carry post-deploy activations/deactivations back (1:1, guaranteed by the checks above).
UPDATE "users" u SET "is_active" = (m."status" = 'active')
FROM "tenant_memberships" m
WHERE m."user_id" = u."id" AND m."tenant_id" = u."tenant_id" AND u."is_active" IS DISTINCT FROM (m."status" = 'active');

DROP TABLE "tenant_memberships";

-- Roles: remove the unused system roles the migration added, then the new columns.
DELETE FROM "roles"
WHERE "is_system" AND "key" IN ('admin', 'operations', 'accounting', 'viewer') AND "name" <> "key";
DROP INDEX "roles_tenant_id_id_scope_key";
DROP INDEX "roles_tenant_id_key_key";
ALTER TABLE "roles" DROP COLUMN "key", DROP COLUMN "scope", DROP COLUMN "is_system";

DROP TYPE "role_scope";
DROP TYPE "invitation_status";
DROP TYPE "membership_status";

DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261029090000_tenant_memberships';
  END IF;
END $$;

COMMIT;
