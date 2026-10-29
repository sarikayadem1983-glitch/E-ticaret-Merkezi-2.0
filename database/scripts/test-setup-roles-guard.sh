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

exit "$FAILED"
