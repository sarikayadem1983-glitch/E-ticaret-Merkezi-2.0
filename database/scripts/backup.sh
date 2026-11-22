#!/usr/bin/env bash
# OPS-03: one unattended backup run of the local/dev stack, verified by a real restore.
#
#   bash database/scripts/backup.sh <out-dir> [keep]
#
# 1. pg_dump (custom format) of POSTGRES_DB, written as .part and renamed only when complete.
# 2. Restore into a throwaway database (tm_backup_check_<pid>); every table's row count must
#    equal the dump's, and constraints, indexes and triggers must exist.
# 3. Object storage (tm-minio /data) as a tar. A stopped tm-minio fails the run unless
#    TM_SKIP_OBJECTS=1 says so explicitly.
# 4. SHA-256 manifest, then retention: this script's own files beyond the newest <keep>
#    (default 14) are removed, only after a successful run.
# Exit 0 only when everything above succeeded. Schedule it outside (cron / Task Scheduler).
#
# Safety: the source database is only read (pg_dump). Only the throwaway database is created or
# dropped. <out-dir> must be outside the repository. No passwords or row contents are printed.
set -euo pipefail
export MSYS_NO_PATHCONV=1
umask 077

REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
ENV_FILE="${TM_ENV_FILE:-$REPO/.env}"
PG=tm-postgres
S3=tm-minio
die() { echo "HATA: $*" >&2; exit 2; }

[ $# -ge 1 ] && [ $# -le 2 ] || die "kullanım: $0 <out-dir> [keep]"
KEEP="${2:-14}"
[[ "$KEEP" =~ ^[1-9][0-9]{0,3}$ ]] || die "keep 1-9999 olmalı"
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# Resolved after creation, so Windows paths and symlinks cannot slip past the check.
NEW=0; [ -d "$1" ] || NEW=1
mkdir -p "$1"
OUT="$(cd "$1" && pwd -P)"
case "$(lc "$OUT")/" in "$(lc "$REPO")"/*)
  [ "$NEW" = 0 ] || rmdir "$OUT"
  die "out-dir repo içinde olamaz" ;;
esac
[ -f "$ENV_FILE" ] || die ".env bulunamadı"
envval() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r"'; }
DB="$(envval POSTGRES_DB)"
SU="$(envval POSTGRES_USER)"
[[ "$DB" =~ ^[a-z0-9_]+$ ]] && [ -n "$SU" ] || die "POSTGRES_DB/POSTGRES_USER eksik veya geçersiz"
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
running "$PG" || die "$PG çalışmıyor"
if [ "${TM_SKIP_OBJECTS:-0}" != 1 ]; then running "$S3" || die "$S3 çalışmıyor (bilerek atlamak için TM_SKIP_OBJECTS=1)"; fi

# One run at a time: two runs would race on retention.
LOCK="$OUT/.backup.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A killed run leaves its lock; every step is time-limited, so two hours means dead.
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120)" ] || die "başka bir yedek sürüyor olabilir: $LOCK"
  echo "uyarı: bayat kilit devralındı" >&2
  touch "$LOCK"
fi
CHECK="tm_backup_check_$$"
TS="$(date -u +%Y%m%d-%H%M%S)"
DUMP="$OUT/$DB-$TS.dump"
TAR="$OUT/$DB-$TS.objects.tar"
SUMS="$OUT/$DB-$TS.sha256"
T="timeout 1800"
DONE=0
psql_su() { $T docker exec -i "$PG" psql -U "$SU" -d "$1" -X -q -At -v ON_ERROR_STOP=1 -c "$2"; }
cleanup() {
  set +e
  psql_su postgres "DROP DATABASE IF EXISTS \"$CHECK\" WITH (FORCE)" >/dev/null 2>&1 || echo "uyarı: $CHECK silinemedi" >&2
  rm -f "$DUMP.part" "$TAR.part" "$SUMS.part"
  [ "$DONE" = 1 ] || rm -f "$DUMP" "$TAR" "$SUMS"
  rmdir "$LOCK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
[ "$CHECK" != "$DB" ] || die "kontrol DB adı kaynakla aynı"

START=$(date +%s)
# Left over by killed runs; the lock guarantees no other run uses them.
for stale in $(psql_su postgres "SELECT datname FROM pg_database WHERE datname ~ '^tm_backup_check_[0-9]+$'"); do
  psql_su postgres "DROP DATABASE IF EXISTS \"$stale\" WITH (FORCE)" >/dev/null
done
$T docker exec "$PG" pg_dump -U "$SU" -d "$DB" -Fc > "$DUMP.part"
[ -s "$DUMP.part" ] || die "dump boş"

psql_su postgres "CREATE DATABASE \"$CHECK\"" >/dev/null
$T docker exec -i "$PG" pg_restore -U "$SU" -d "$CHECK" --exit-on-error < "$DUMP.part"
DUMPED="$($T docker exec -i "$PG" pg_restore --data-only -f - < "$DUMP.part" | awk '
  inside && /^\\\.$/ { print t "|" n; inside=0; next }
  inside { n++; next }
  /^COPY public\..* FROM stdin;$/ { t=$2; sub(/^public\./, "", t); gsub(/"/, "", t); n=0; inside=1 }' | LC_ALL=C sort)"
RESTORED="$(psql_su "$CHECK" "SELECT t.table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'" | LC_ALL=C sort)"
[ -n "$RESTORED" ] || die "geri yüklenen DB'de tablo yok"
[ "$DUMPED" = "$RESTORED" ] || die "satır sayıları eşleşmiyor"
OBJECTS="$(psql_su "$CHECK" "SELECT (SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace) || ' kısıt, ' || (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') || ' indeks, ' || (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT tgisinternal AND c.relnamespace = 'public'::regnamespace) || ' tetikleyici'")"
case "$OBJECTS" in "0 "* | *" 0 "*) die "şema nesneleri eksik: $OBJECTS" ;; esac
mv "$DUMP.part" "$DUMP"

FILES=("$(basename "$DUMP")")
if [ "${TM_SKIP_OBJECTS:-0}" != 1 ]; then
  $T docker cp "$S3:/data" - > "$TAR.part"
  tar -tf "$TAR.part" >/dev/null || die "nesne arşivi okunamıyor"
  mv "$TAR.part" "$TAR"
  FILES+=("$(basename "$TAR")")
else
  echo "uyarı: TM_SKIP_OBJECTS=1, nesne depolama yedeklenmedi" >&2
fi
(cd "$OUT" && sha256sum "${FILES[@]}" > "$SUMS.part" && sha256sum -c --quiet "$SUMS.part")
mv "$SUMS.part" "$SUMS"
DONE=1

# Retention: exact names of this script only, newest first by the timestamp in the name.
STAMP='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]'
REMOVED=0
while IFS= read -r old; do
  # Never the set just written, even if the clock was moved back.
  [ "$old" != "$SUMS" ] || continue
  base="${old%.sha256}"
  rm -f -- "$base.dump" "$base.objects.tar" "$old"
  REMOVED=$((REMOVED + 1))
done < <(find "$OUT" -maxdepth 1 -type f -name "$DB-$STAMP.sha256" | LC_ALL=C sort -r | tail -n +"$((KEEP + 1))")

echo "ok: $(basename "$DUMP") $(wc -c < "$DUMP") bayt; $(printf '%s\n' "$RESTORED" | wc -l | tr -d ' ') tablo eşit; $OBJECTS; süre $(($(date +%s) - START)) sn; silinen eski $REMOVED"
