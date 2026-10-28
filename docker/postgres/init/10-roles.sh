#!/bin/sh
# Runs once on a fresh volume (docker-entrypoint-initdb.d). Creates tm_migrator and tm_app.
set -eu
: "${TM_APP_DB_PASSWORD:?TM_APP_DB_PASSWORD is required}"
: "${TM_MIGRATOR_DB_PASSWORD:?TM_MIGRATOR_DB_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$TM_APP_DB_PASSWORD" \
  -v migrator_password="$TM_MIGRATOR_DB_PASSWORD" \
  -f /sql/roles/setup-roles.sql
