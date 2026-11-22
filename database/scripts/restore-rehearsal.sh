#!/usr/bin/env bash
# OPS-03: full restore drill of one backup.sh set into a clean environment.
#
#   bash database/scripts/restore-rehearsal.sh <set>.sha256
#
# A new PostgreSQL cluster (roles created from setup-roles.sql, then pg_restore), a new MinIO with
# the object archive, and the built backend running on both. Checks: checksums, row counts against
# the dump, migrations complete, ownership and tm_app limits, every active product image readable
# with the size the database says, anonymous reads refused, backend /health up.
# Needs backend/node_modules, backend/dist and the tm-minio:dev image.
#
# Safety: the backup set is only read. Everything runs in throwaway containers, volumes and
# loopback ports named tm-drill-<pid>; no existing container or database is touched. Passwords are
# generated for the run. No row contents are printed.
set -euo pipefail
export MSYS_NO_PATHCONV=1
umask 077
die() { echo "HATA: $*" >&2; exit 2; }

[ $# -eq 1 ] && [ -f "$1" ] || die "kullanım: $0 <set>.sha256"
REPO="$(cd "$(dirname "$0")/../.." && pwd -P)"
DIR="$(cd "$(dirname "$1")" && pwd -P)"
BASE="$(basename "$1" .sha256)"
SUMS="$DIR/$BASE.sha256"
DUMP="$DIR/$BASE.dump"
TAR="$DIR/$BASE.objects.tar"
[ -f "$DUMP" ] && [ -f "$TAR" ] || die "set eksik (.dump ve .objects.tar gerekli)"
[ -f "$REPO/backend/dist/main.js" ] || die "backend derlenmemiş"

ID="tm-drill-$$"
PG="$ID-pg"; S3="$ID-s3"; REDIS="$ID-redis"; VOL="$ID-vol"
BE=""
TMP="$(mktemp -d)"
cleanup() {
  set +e
  [ -z "$BE" ] || kill "$BE" 2>/dev/null
  docker rm -fv "$PG" "$S3" "$REDIS" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
rnd() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; }
port() { docker port "$1" "$2" | head -n1 | sed 's/.*://'; }
win() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
psql_su() { docker exec -i "$PG" psql -U drill_su -d drill -X -q -At -v ON_ERROR_STOP=1 "$@"; }
ok() { echo "ok: $*"; }
START=$(date +%s)

# 1. Checksums: both files must be listed, and match.
for f in "$BASE.dump" "$BASE.objects.tar"; do
  awk -v f="$f" '{ n=$2; sub(/^\*/, "", n); if (n == f) found=1 } END { exit !found }' "$SUMS" || die "sha256 listesinde yok: $f"
done
(cd "$DIR" && sha256sum -c --quiet "$BASE.sha256")
ok "sha256"

# 2. New cluster: nothing but the superuser exists before setup-roles.sql.
APP_PW="$(rnd)"; MIG_PW="$(rnd)"
docker run -d --name "$PG" -p 127.0.0.1::5432 -e POSTGRES_USER=drill_su -e POSTGRES_PASSWORD="$(rnd)" \
  -e POSTGRES_DB=drill postgres:16-alpine >/dev/null
for i in $(seq 1 90); do
  docker exec "$PG" pg_isready -h 127.0.0.1 -U drill_su -d drill >/dev/null 2>&1 && break
  [ "$i" -lt 90 ] || die "postgres açılmadı"
  sleep 1
done
[ "$(psql_su -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'tm\_%'")" = 0 ] || die "küme temiz değil"
{ printf "\\\\set app_password '%s'\n\\\\set migrator_password '%s'\n" "$APP_PW" "$MIG_PW"; cat "$REPO/database/roles/setup-roles.sql"; } | psql_su >/dev/null
RS=$(date +%s)
docker exec -i "$PG" pg_restore -U drill_su -d drill --exit-on-error < "$DUMP"
ok "pg_restore ($(($(date +%s) - RS)) sn)"

# 3. Database content.
DUMPED="$(docker exec -i "$PG" pg_restore --data-only -f - < "$DUMP" | awk '
  inside && /^\\\.$/ { print t "|" n; inside=0; next }
  inside { n++; next }
  /^COPY public\..* FROM stdin;$/ { t=$2; sub(/^public\./, "", t); gsub(/"/, "", t); n=0; inside=1 }' | LC_ALL=C sort)"
RESTORED="$(psql_su -c "SELECT t.table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'" | LC_ALL=C sort)"
[ -n "$RESTORED" ] && [ "$DUMPED" = "$RESTORED" ] || die "satır sayıları eşleşmiyor"
ok "$(printf '%s\n' "$RESTORED" | wc -l | tr -d ' ') tablo eşit"
expect() { local r; r="$(psql_su -c "$2")"; [ "$r" = "$1" ] || die "$3 ($r)"; }
expect 0 "SELECT count(*) FROM pg_constraint WHERE NOT convalidated" "doğrulanmamış kısıt"
expect 0 "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner <> 'tm_migrator'" "tablo sahipliği tm_migrator değil"
expect 0 "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND has_table_privilege('tm_app', oid, 'TRUNCATE')" "tm_app TRUNCATE yetkili"
expect f "SELECT has_database_privilege('tm_app','drill','CREATE') OR has_schema_privilege('tm_app','public','CREATE')" "tm_app şema yetkisi fazla"
ok "sahiplik ve tm_app sınırları"

P="$(port "$PG" 5432)"
export DATABASE_URL="postgresql://tm_app:$APP_PW@127.0.0.1:$P/drill"
export MIGRATION_DATABASE_URL="postgresql://tm_migrator:$MIG_PW@127.0.0.1:$P/drill"
(cd "$REPO/backend" && npx prisma migrate status > "$TMP/mig.log" 2>&1) || die "migrate status: $(tail -n3 "$TMP/mig.log")"
ok "migrate status güncel"

# 4. Object archive into a new MinIO; the files are written before it starts.
STORAGE_ACCESS_KEY="drill$(rnd | cut -c1-12)"
STORAGE_SECRET_KEY="$(rnd)"
# The bucket is the only non-system folder under data/.
tar -tf "$TAR" | sed -nE 's#^data/([a-z0-9][a-z0-9.-]+)/.*#\1#p' | sort -u > "$TMP/buckets"
[ "$(wc -l < "$TMP/buckets" | tr -d ' ')" = 1 ] || die "arşivde tam bir kova bekleniyordu"
STORAGE_BUCKET="$(cat "$TMP/buckets")"
export STORAGE_ACCESS_KEY STORAGE_SECRET_KEY STORAGE_BUCKET STORAGE_REGION=us-east-1 STORAGE_FORCE_PATH_STYLE=true
docker volume create "$VOL" >/dev/null
docker run --rm -i -u 0 -v "$VOL:/data" --entrypoint sh tm-minio:dev -c 'tar -xf - -C / && chown -R minio /data' < "$TAR"
docker run -d --name "$S3" -p 127.0.0.1::9000 -v "$VOL:/data" -e MINIO_ROOT_USER="$STORAGE_ACCESS_KEY" \
  -e MINIO_ROOT_PASSWORD="$STORAGE_SECRET_KEY" -e MINIO_BUCKET="$STORAGE_BUCKET" tm-minio:dev >/dev/null
STORAGE_ENDPOINT="http://127.0.0.1:$(port "$S3" 9000)"
export STORAGE_ENDPOINT
for i in $(seq 1 60); do
  curl -sf "$STORAGE_ENDPOINT/minio/health/live" >/dev/null && break
  [ "$i" -lt 60 ] || die "MinIO açılmadı"
  sleep 1
done
psql_su -c "SELECT storage_key || '|' || byte_size || '|' || content_type FROM product_images WHERE deleted_at IS NULL" > "$TMP/images"
cat > "$TMP/check.mjs" <<'EOF'
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const [, , pkg, list] = process.argv;
const require = createRequire(pkg);
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const e = process.env;
const s3 = new S3Client({
  endpoint: e.STORAGE_ENDPOINT, region: e.STORAGE_REGION, forcePathStyle: true,
  credentials: { accessKeyId: e.STORAGE_ACCESS_KEY, secretAccessKey: e.STORAGE_SECRET_KEY },
});
const rows = readFileSync(list, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('|'));
if (rows.length === 0) throw new Error('yedekte etkin görsel yok: nesne geri yüklemesi kanıtlanamaz');
for (const [Key, size, type] of rows) {
  const o = await s3.send(new GetObjectCommand({ Bucket: e.STORAGE_BUCKET, Key }));
  const body = Buffer.from(await o.Body.transformToByteArray());
  if (body.length !== Number(size)) throw new Error('boyut farklı');
  if (o.ContentType !== type) throw new Error('içerik türü farklı');
  await sharp(body).stats(); // decodes every pixel
  const anon = await fetch(`${e.STORAGE_ENDPOINT}/${e.STORAGE_BUCKET}/${Key}`);
  if (anon.status !== 403) throw new Error(`anonim okuma ${anon.status}`);
}
let total = 0, token;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: e.STORAGE_BUCKET, ContinuationToken: token }));
  total += r.KeyCount ?? 0;
  token = r.NextContinuationToken;
} while (token);
console.log(`ok: ${rows.length} etkin görsel okundu, boyut/tür/çözme doğru, anonim 403; depoda ${total} nesne`);
EOF
node "$(win "$TMP/check.mjs")" "$(win "$REPO/backend/package.json")" "$(win "$TMP/images")"

# 5. The application itself on the restored data; its own Redis, no workers, no live calls.
docker run -d --name "$REDIS" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
REDIS_URL="redis://127.0.0.1:$(port "$REDIS" 6379)"
JWT_ACCESS_SECRET="$(rnd)"
export REDIS_URL JWT_ACCESS_SECRET BACKEND_PORT="${DRILL_BACKEND_PORT:-4199}"
export QUEUE_WORKERS=false SYNC_LIVE_CALLS=false MAIL_TRANSPORT=log
(cd "$REPO/backend" && exec node dist/main) > "$TMP/be.log" 2>&1 &
BE=$!
HEALTH=""
for _ in $(seq 1 60); do
  kill -0 "$BE" 2>/dev/null || die "backend kapandı: $(tail -n3 "$TMP/be.log")"
  HEALTH="$(curl -sf "http://127.0.0.1:$BACKEND_PORT/api/v1/health")" && break
  sleep 1
done
case "$HEALTH" in *'"status":"ok"'*'"database":"up"'*) ok "backend /health" ;; *) die "health: $HEALTH" ;; esac
[ "$(curl -s -w '|%{http_code}' "http://127.0.0.1:$BACKEND_PORT/api/v1/auth/me" | sed "s/.*|//")" = 401 ] || die "yetkisiz istek 401 değil"
kill -0 "$BE" 2>/dev/null || die "yanıt bu tatbikatın backend'inden gelmedi"
ok "toplam $(($(date +%s) - START)) sn"
