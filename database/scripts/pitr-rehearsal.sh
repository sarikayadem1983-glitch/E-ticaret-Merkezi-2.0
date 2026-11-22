#!/usr/bin/env bash
# OPS-03: point-in-time recovery drill. Synthetic data only, in two throwaway containers without
# published ports and one throwaway volume. Never touches tm-postgres or any other container.
#
#   bash database/scripts/pitr-rehearsal.sh
#
# Writes row 1, takes a base backup, writes row 2 ("good"), notes the time, then a simulated
# accident deletes everything. Recovery to the noted time must give back rows 1 and 2.
set -euo pipefail
export MSYS_NO_PATHCONV=1

ID="tm-pitr-$$"
SRC="$ID-src"
DST="$ID-dst"
VOL="$ID-vol"
IMG=postgres:16-alpine
cleanup() {
  set +e
  docker rm -f "$SRC" "$DST" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
}
trap cleanup EXIT
die() { echo "HATA: $*" >&2; exit 2; }
q() { docker exec "$1" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -c "$2"; }
# The init phase runs a temporary server on the socket only: wait for TCP.
ready() {
  for _ in $(seq 1 60); do
    docker exec "$1" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && return 0
    sleep 1
  done
  docker logs --tail 15 "$1" >&2
  die "$1 açılmadı"
}

docker volume create "$VOL" >/dev/null
docker run --rm -v "$VOL:/b" "$IMG" sh -c 'mkdir -p /b/wal && chown -R postgres:postgres /b'
docker run -d --name "$SRC" -e POSTGRES_HOST_AUTH_METHOD=trust -v "$VOL:/b" "$IMG" \
  -c archive_mode=on -c archive_timeout=60 -c wal_level=replica \
  -c 'archive_command=test ! -f /b/wal/%f && cp %p /b/wal/%f' >/dev/null
ready "$SRC"

q "$SRC" "CREATE TABLE t (id int PRIMARY KEY); INSERT INTO t VALUES (1)"
docker exec -u postgres "$SRC" pg_basebackup -U postgres -D /b/base -X none -c fast 2>/dev/null
docker exec -u postgres "$SRC" pg_verifybackup -n /b/base >/dev/null
q "$SRC" "INSERT INTO t VALUES (2)"
sleep 2
TARGET="$(q "$SRC" "SELECT clock_timestamp()")"
sleep 2
q "$SRC" "DELETE FROM t"
[ "$(q "$SRC" "SELECT count(*) FROM t")" = 0 ] || die "kaza simüle edilemedi"
SEG="$(q "$SRC" "SELECT pg_walfile_name(pg_switch_wal())")"
for _ in $(seq 1 60); do
  docker exec "$SRC" test -f "/b/wal/$SEG" && break
  sleep 1
done
docker exec "$SRC" test -f "/b/wal/$SEG" || die "WAL arşivlenmedi"
docker rm -f "$SRC" >/dev/null

START=$(date +%s)
docker run --rm -u postgres -e T="$TARGET" -v "$VOL:/b" "$IMG" sh -c '
  cp -r /b/base /b/restored && chmod 700 /b/restored && touch /b/restored/recovery.signal &&
  printf "restore_command = '\''cp /b/wal/%%f %%p'\''\nrecovery_target_time = '\''%s'\''\nrecovery_target_action = promote\narchive_mode = off\n" "$T" >> /b/restored/postgresql.auto.conf'
docker run -d --name "$DST" -e PGDATA=/b/restored -v "$VOL:/b" "$IMG" >/dev/null
ready "$DST"
for _ in $(seq 1 30); do
  [ "$(q "$DST" "SELECT pg_is_in_recovery()")" = f ] && break
  sleep 1
done
GOT="$(q "$DST" "SELECT string_agg(id::text, ',' ORDER BY id) FROM t")"
[ "$GOT" = "1,2" ] || die "beklenen 1,2 bulunan '$GOT'"
[ "$(q "$DST" "SELECT pg_is_in_recovery()")" = f ] || die "kurtarma tamamlanmadı"
echo "ok: hedef $TARGET anına dönüldü; satırlar $GOT; kurtarma $(($(date +%s) - START)) sn"
