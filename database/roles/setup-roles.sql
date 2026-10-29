-- Bootstrap database roles. Run as a superuser, once per database; safe to re-run.
-- Required psql variables: app_password, migrator_password
--   psql -v ON_ERROR_STOP=1 -v app_password=... -v migrator_password=... -f setup-roles.sql
-- No data is modified: only roles, ownership and privileges change.

\set ON_ERROR_STOP on

-- Guard: stop before any change when a password is missing or empty. An empty
-- value would clear the role's password (ALTER ROLE ... PASSWORD '').
-- Test: database/scripts/test-setup-roles-guard.sh
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'setup-roles durdu: app_password verilmedi, hiçbir değişiklik yapılmadı'; END $$;
\endif
\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'setup-roles durdu: migrator_password verilmedi, hiçbir değişiklik yapılmadı'; END $$;
\endif
SELECT btrim(:'app_password') = '' OR btrim(:'migrator_password') = '' AS setup_roles_empty_password \gset
\if :setup_roles_empty_password
  DO $$ BEGIN RAISE EXCEPTION 'setup-roles durdu: parola boş, hiçbir değişiklik yapılmadı'; END $$;
\endif

-- Roles ---------------------------------------------------------------------

SELECT 'CREATE ROLE tm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_migrator') \gexec

SELECT 'CREATE ROLE tm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tm_app') \gexec

-- Re-assert attributes and set passwords (rotation = re-run with new values).
ALTER ROLE tm_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE tm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
SELECT format('ALTER ROLE tm_migrator PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE tm_app PASSWORD %L', :'app_password') \gexec

-- Database and schema -------------------------------------------------------

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO tm_app, tm_migrator', current_database()) \gexec

ALTER SCHEMA public OWNER TO tm_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tm_app;

-- Hand every existing object in public to tm_migrator (existing installs).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  LOOP
    EXECUTE format(
      'ALTER %s public.%I OWNER TO tm_migrator',
      CASE r.relkind WHEN 'S' THEN 'SEQUENCE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
      r.relname);
  END LOOP;
  FOR r IN
    SELECT t.typname FROM pg_type t
    WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e', 'd', 'c')
      AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO tm_migrator', r.typname);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO tm_migrator', r.sig);
  END LOOP;
END $$;

-- Privileges for tm_app -----------------------------------------------------

-- Existing objects.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Future objects created by tm_migrator.
ALTER DEFAULT PRIVILEGES FOR ROLE tm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tm_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Exceptions (also enforced by migration app_role_privileges for new installs).
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON public._prisma_migrations FROM tm_app;
  END IF;
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_logs FROM tm_app;
  END IF;
  -- Memberships and invitations are deactivated / revoked, never deleted
  -- (also enforced by migration tenant_memberships).
  IF to_regclass('public.tenant_memberships') IS NOT NULL THEN
    REVOKE ALL ON public.tenant_memberships FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON public.tenant_memberships TO tm_app;
  END IF;
  IF to_regclass('public.invitations') IS NOT NULL THEN
    REVOKE ALL ON public.invitations FROM tm_app;
    GRANT SELECT, INSERT, UPDATE ON public.invitations TO tm_app;
  END IF;
END $$;
