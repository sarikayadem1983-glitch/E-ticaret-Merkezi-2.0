-- Audit purge gate: only the table owner's session may use app.allow_audit_purge.
-- Any other role (e.g. tm_app) setting the flag is still rejected.
CREATE OR REPLACE FUNCTION "audit_logs_immutable"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.allow_audit_purge', true) = 'on'
     AND pg_has_role(
           current_user,
           (SELECT relowner FROM pg_class WHERE oid = TG_RELID),
           'MEMBER') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION "audit_logs_immutable"() FROM PUBLIC;

-- Least privilege for the application role, if it exists (see database/roles/setup-roles.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "audit_logs" FROM tm_app;
    REVOKE ALL ON "_prisma_migrations" FROM tm_app;
  END IF;
END $$;
