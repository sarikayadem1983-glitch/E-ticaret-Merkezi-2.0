#!/usr/bin/env bash
# Checks that setup-roles.sql stops before any change when a password is missing
# or empty. Runs in a throwaway postgres container: no port is published and no
# existing database or .env is used. Requires Docker.
#   bash database/scripts/test-setup-roles-guard.sh
set -euo pipefail
# Git Bash on Windows would rewrite container paths such as /tmp/... otherwise.
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="tm-roles-guard-test-$$"
FAILED=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=throwaway-only \
  -e POSTGRES_DB=guard_test postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -d guard_test >/dev/null 2>&1 && break
  sleep 1
done
# pg_isready can pass during the init restart; wait for a real query.
for _ in $(seq 1 30); do
  docker exec "$NAME" psql -U postgres -d guard_test -Atc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$NAME" sh -c 'cat > /tmp/setup-roles.sql' \
  < "$ROOT/database/roles/setup-roles.sql"

run_setup() {
  docker exec "$NAME" psql -U postgres -d guard_test -X -q -f /tmp/setup-roles.sql "$@" >/dev/null 2>&1
}

role_count() {
  docker exec "$NAME" psql -U postgres -d guard_test -Atc \
    "SELECT count(*) FROM pg_roles WHERE rolname IN ('tm_app','tm_migrator')"
}

expect_refused() {
  local label="$1"; shift
  local out
  if out="$(docker exec "$NAME" psql -U postgres -d guard_test -X -q \
      -f /tmp/setup-roles.sql "$@" 2>&1)"; then
    echo "FAIL: $label: script succeeded"; FAILED=1
  elif ! grep -q 'setup-roles durdu' <<<"$out"; then
    # Refused for another reason (file missing, syntax error): not the guard.
    echo "FAIL: $label: not stopped by the guard"; FAILED=1
  elif [ "$(role_count)" != "0" ]; then
    echo "FAIL: $label: roles were created"; FAILED=1
  else
    echo "ok: $label refused, nothing changed"
  fi
}

expect_refused "no passwords"
expect_refused "missing migrator_password" -v app_password=a-strong-test-value
expect_refused "empty app_password" -v app_password= -v migrator_password=a-strong-test-value
expect_refused "whitespace migrator_password" -v app_password=a-strong-test-value -v "migrator_password=   "

if run_setup -v app_password=a-strong-test-value -v migrator_password=another-test-value \
  && [ "$(role_count)" = "2" ] \
  && [ "$(docker exec "$NAME" psql -U postgres -d guard_test -Atc \
        "SELECT bool_and(rolpassword IS NOT NULL) FROM pg_authid WHERE rolname IN ('tm_app','tm_migrator')")" = "t" ]; then
  echo "ok: valid passwords create both roles with a password"
else
  echo "FAIL: valid passwords"; FAILED=1
fi

# Managed PostgreSQL: the admin has CREATEROLE but no SUPERUSER and owns its database.
su_sql() { docker exec "$NAME" psql -U postgres -d postgres -X -q -At -c "$1"; }
as_admin() {
  docker exec "$NAME" psql -U managed_admin -d managed -X -q -f /tmp/setup-roles.sql     -v app_password=a-strong-test-value -v migrator_password=another-test-value >/dev/null 2>&1
}
su_sql "DROP OWNED BY tm_app, tm_migrator"
docker exec "$NAME" psql -U postgres -d guard_test -X -q -c "ALTER SCHEMA public OWNER TO postgres"   -c "DROP OWNED BY tm_app, tm_migrator" -c "DROP ROLE tm_app" -c "DROP ROLE tm_migrator"
su_sql "CREATE ROLE managed_admin LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS"
docker exec "$NAME" psql -U managed_admin -d postgres -X -q -c "CREATE DATABASE managed"
if as_admin && as_admin   && [ "$(su_sql "SELECT count(*) FROM pg_roles WHERE rolname IN ('tm_app','tm_migrator') AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)")" = 2 ]   && [ "$(su_sql "SELECT pg_has_role('tm_app', 'tm_migrator', 'MEMBER') OR pg_has_role('tm_app', 'managed_admin', 'MEMBER')")" = f ]; then
  echo "ok: managed admin creates both roles, twice"
else
  echo "FAIL: managed admin"; FAILED=1
fi
for attr in SUPERUSER CREATEDB; do
  su_sql "ALTER ROLE tm_app $attr"
  if as_admin; then echo "FAIL: managed admin accepted tm_app $attr"; FAILED=1; else echo "ok: managed admin stops on tm_app $attr"; fi
  su_sql "ALTER ROLE tm_app NO$attr"
done
su_sql "ALTER ROLE tm_app SUPERUSER"
if run_setup -v app_password=a-strong-test-value -v migrator_password=another-test-value   && [ "$(su_sql "SELECT rolsuper FROM pg_roles WHERE rolname = 'tm_app'")" = f ]; then
  echo "ok: superuser repairs tm_app SUPERUSER"
else
  echo "FAIL: superuser repair"; FAILED=1
fi

exit "$FAILED"
