-- User management, phase 2 (PREPARED, NOT APPLIED). Lives outside prisma/migrations on purpose:
-- prisma migrate deploy must not pick it up. Move it into database/prisma/migrations/<ts>_drop_legacy_user_columns/
-- only after: phase 1 is applied and verified on the dev database, no code reads users.tenant_id / users.is_active,
-- and the Prisma schema drops both fields in the same change. Rehearse first with database/scripts/backup-and-rehearse.sh.
-- Irreversible without a backup: rollback.sql of phase 1 no longer works once these columns are gone.

DO $$
BEGIN
  IF to_regclass('public.tenant_memberships') IS NULL THEN
    RAISE EXCEPTION 'aşama 2 durdu: aşama 1 (tenant_memberships) uygulanmamış';
  END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.tenant_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM tenant_memberships m WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id)) THEN
    RAISE EXCEPTION 'aşama 2 durdu: users.tenant_id üyeliğe karşılık gelmeyen kullanıcı var';
  END IF;
END $$;

-- Drops the (tenant_id, id) unique index and the tenant_id index together with the column.
ALTER TABLE "users" DROP COLUMN "tenant_id", DROP COLUMN "is_active";

-- Phase 1 snapshots are no longer needed.
DROP TABLE IF EXISTS _mig_snapshot_users, _mig_snapshot_user_roles, _mig_snapshot_user_company_roles,
  _mig_snapshot_refresh_tokens, _mig_snapshot_audit;
