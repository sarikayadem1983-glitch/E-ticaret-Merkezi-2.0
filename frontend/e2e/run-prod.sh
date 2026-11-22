#!/usr/bin/env bash
# Browser tests against the production build, over TLS (R-24). The HTTPS rules of server.mjs and
# session.ts stay on: a local proxy terminates TLS with a throwaway certificate, as in production.
#
#   bash frontend/e2e/run-prod.sh [playwright args]
#
# Needs: backend built, migrations applied, and DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET,
# SESSION_SECRET, SMTP_* (Mailpit) and STORAGE_* (local MinIO on MINIO_PORT) in the environment.
# Use a throwaway database and Redis database: the tests create accounts and clear rate limits.
# The backend runs without NODE_ENV=production: that mode refuses Mailpit (SMTP without TLS).
set -euo pipefail

FE="$(cd "$(dirname "$0")/.." && pwd)"
APP_TLS="${E2E_TLS_PORT:-3443}"
S3_TLS="${E2E_STORAGE_TLS_PORT:-9443}"
export BACKEND_PORT="${BACKEND_PORT:-4000}"
export FRONTEND_PORT="${FRONTEND_PORT:-3000}"
TMP="$(mktemp -d)"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT

MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost -keyout - -out - 2>/dev/null > "$TMP/both.pem"
KEY="$TMP/both.pem"
CERT="$TMP/both.pem"

export APP_ORIGIN="https://localhost:$APP_TLS" FRONTEND_URL="https://localhost:$APP_TLS"
export BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
export STORAGE_ENDPOINT="https://localhost:$S3_TLS" STORAGE_FORCE_PATH_STYLE=true
# The proxies are the only trusted hops; the backend calls storage over TLS with this certificate.
export BFF_TRUST_PROXY=loopback TRUST_PROXY=loopback
export NODE_EXTRA_CA_CERTS="$CERT"
export NEXT_TELEMETRY_DISABLED=1
LOGS="${E2E_LOG_DIR:-$FE/test-results-logs}"
mkdir -p "$LOGS"

(cd "$FE" && NODE_ENV=production npm run build > "$LOGS/build.log" 2>&1) || { tail -30 "$LOGS/build.log"; exit 1; }

node "$FE/e2e/tls-proxy.mjs" "$KEY" "$CERT" "$APP_TLS:$FRONTEND_PORT" "$S3_TLS:${MINIO_PORT:-9000}" > "$LOGS/proxy.log" 2>&1 &
PIDS+=($!)
(cd "$FE/../backend" && exec node dist/main) > "$LOGS/backend.log" 2>&1 &
PIDS+=($!)
(cd "$FE" && NODE_ENV=production exec node server.mjs) > "$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

wait_for() {
  for _ in $(seq 1 60); do
    curl -sf --cacert "$CERT" -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "HATA: açılmadı: $1" >&2
  tail -20 "$LOGS"/*.log >&2
  return 1
}
wait_for "$BACKEND_URL/api/v1/health"
wait_for "$APP_ORIGIN/login"

# The protection under test must be on: plain HTTP is redirected (reads) and refused (writes).
PLAIN="http://127.0.0.1:$FRONTEND_PORT"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PLAIN/login")" = 308 ] || { echo "HATA: HTTP okuma yönlendirilmedi" >&2; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PLAIN/api/session")" = 426 ] || { echo "HATA: HTTP yazma reddedilmedi" >&2; exit 1; }
HEADERS="$(curl -s --cacert "$CERT" -D - -o /dev/null "$APP_ORIGIN/login")"
grep -qi '^strict-transport-security:' <<< "$HEADERS" || { echo "HATA: HSTS yok" >&2; exit 1; }
echo "ok: HTTP 308/426, HSTS"

cd "$FE"
E2E_BASE_URL="$APP_ORIGIN" npx playwright test "$@"
