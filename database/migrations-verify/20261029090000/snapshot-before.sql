-- Snapshot taken immediately BEFORE migration 20261029090000_tenant_memberships.
-- Run as tm_migrator on the target database. verify-after.sql compares against these tables.
-- Fails if a snapshot already exists (never overwrite an earlier snapshot by accident).
-- Password hashes are stored only as md5 digests. Drop the _mig_snapshot_* tables after phase 2.

BEGIN;

CREATE TABLE _mig_snapshot_users AS
  SELECT id, tenant_id, is_active, md5(password_hash) AS password_md5
  FROM users;

CREATE TABLE _mig_snapshot_user_roles AS
  SELECT ur.tenant_id, ur.user_id, ur.role_id, r.name AS role_name
  FROM user_roles ur JOIN roles r ON r.id = ur.role_id;

CREATE TABLE _mig_snapshot_user_company_roles AS
  SELECT tenant_id, user_id, company_id, role_id
  FROM user_company_roles;

CREATE TABLE _mig_snapshot_refresh_tokens AS
  SELECT id, tenant_id, user_id
  FROM refresh_tokens;

CREATE TABLE _mig_snapshot_audit AS
  SELECT count(*) AS row_count,
         md5(coalesce(string_agg(id::text, '' ORDER BY id), '')) AS id_md5,
         md5(coalesce(string_agg(a::text, '' ORDER BY id), '')) AS rows_md5
  FROM audit_logs a;

-- The application role must never read the snapshots.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE ALL ON _mig_snapshot_users, _mig_snapshot_user_roles, _mig_snapshot_user_company_roles,
                  _mig_snapshot_refresh_tokens, _mig_snapshot_audit FROM tm_app;
  END IF;
END $$;

COMMIT;
