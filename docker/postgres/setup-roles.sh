#!/bin/sh
# Applies database/roles/setup-roles.sql to the running tm-postgres container.
# Use on an existing volume (fresh volumes run it automatically). Idempotent, no data changes.
set -eu
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo ".env not found" >&2; exit 1; }
set -a; . ./.env; set +a
: "${TM_APP_DB_PASSWORD:?set TM_APP_DB_PASSWORD in .env}"
: "${TM_MIGRATOR_DB_PASSWORD:?set TM_MIGRATOR_DB_PASSWORD in .env}"
docker exec -i tm-postgres psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-ticaret_merkezi}" \
  -v app_password="$TM_APP_DB_PASSWORD" \
  -v migrator_password="$TM_MIGRATOR_DB_PASSWORD" \
  < database/roles/setup-roles.sql
