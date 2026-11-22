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
# Incremental builds rewrite only changed files: compare with the newest output.
BUILT="$(find "$REPO/backend/dist" "$REPO/backend" -maxdepth 6 -path '*/node_modules' -prune -o -type f \( -path '*/dist/*.js' -o -name '*.tsbuildinfo' \) -printf '%T@ %p\n' | sort -n | tail -n1 | cut -d' ' -f2-)"
[ -z "$(find "$REPO/backend/src" -name '*.ts' ! -name '*.spec.ts' -newer "$BUILT" | head -n1)" ] || die "backend/dist kaynaktan eski: npm run build"

ID="tm-drill-$$"
PG="$ID-pg"; S3="$ID-s3"; REDIS="$ID-redis"; VOL="$ID-vol"
LABEL="tm-drill=1"
# A killed run leaves real data behind; never start on top of it unnoticed.
LEFT="$(docker ps -aq --filter "label=$LABEL" && docker volume ls -q --filter "label=$LABEL")"
[ -z "$LEFT" ] || die "önceki tatbikattan kalan konteyner/birim var (başka tatbikat sürmüyorsa silin): $(echo $LEFT)"
BE=""
TMP="$(mktemp -d)"
cleanup() {
  set +e
  if [ -n "$BE" ]; then
    # Git Bash: the child is a native process; end it by its Windows PID.
    if [ -r "/proc/$BE/winpid" ]; then taskkill /F /T /PID "$(cat "/proc/$BE/winpid")" >/dev/null 2>&1; fi
    kill -9 "$BE" 2>/dev/null
    wait "$BE" 2>/dev/null
  fi
  docker rm -fv "$PG" "$S3" "$REDIS" >/dev/null 2>&1
  docker volume rm "$VOL" >/dev/null 2>&1
  rm -rf "$TMP" || echo "uyarı: $TMP silinemedi" >&2
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
  [ "$(awk -v f="$f" 'length($1) == 64 && $1 !~ /[^0-9a-f]/ && NF == 2 && ($2 == f || $2 == "*" f)' "$SUMS" | wc -l | tr -d ' ')" = 1 ] || die "sha256 listesinde geçerli tek satır yok: $f"
done
(cd "$DIR" && sha256sum -c --strict --quiet "$BASE.sha256")
ok "sha256"

# 2. New cluster: nothing but the superuser exists before setup-roles.sql.
APP_PW="$(rnd)"; MIG_PW="$(rnd)"
docker run -d --label "$LABEL" --name "$PG" -p 127.0.0.1::5432 -e POSTGRES_USER=drill_su -e POSTGRES_PASSWORD="$(rnd)" \
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
# Only plain files and folders under data/; the archive is unpacked as root (in a container).
tar -tf "$TAR" > "$TMP/names"
[ -s "$TMP/names" ] || die "nesne arşivi boş"
if grep -qvE '^data(/|$)' "$TMP/names" || grep -qE '(^|/)\.\.(/|$)' "$TMP/names"; then die "arşivde data/ dışında yol var"; fi
tar -tvf "$TAR" | cut -c1 > "$TMP/types"
if grep -qv '^[-d]$' "$TMP/types"; then die "arşivde bağ veya özel dosya var"; fi
# The bucket is the only non-system folder under data/.
sed -nE 's#^data/([a-z0-9][a-z0-9.-]+)/.*#\1#p' "$TMP/names" | sort -u > "$TMP/buckets"
[ "$(wc -l < "$TMP/buckets" | tr -d ' ')" = 1 ] || die "arşivde tam bir kova bekleniyordu"
STORAGE_BUCKET="$(cat "$TMP/buckets")"
export STORAGE_ACCESS_KEY STORAGE_SECRET_KEY STORAGE_BUCKET STORAGE_REGION=us-east-1 STORAGE_FORCE_PATH_STYLE=true
docker volume create --label "$LABEL" "$VOL" >/dev/null
docker run --rm -i --label "$LABEL" -u 0 -v "$VOL:/data" --entrypoint sh tm-minio:dev -c 'tar -xf - -C / && chown -R minio /data' < "$TAR"
docker run -d --label "$LABEL" --name "$S3" -p 127.0.0.1::9000 -v "$VOL:/data" -e MINIO_ROOT_USER="$STORAGE_ACCESS_KEY" \
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
if (total !== Number(e.OBJECTS)) throw new Error(`nesne sayısı: depo ${total}, arşiv ${e.OBJECTS}`);
console.log(`ok: ${rows.length} etkin görsel okundu, boyut/tür/çözme doğru, anonim 403; depoda ${total} nesne (arşivle eşit)`);
EOF
OBJECTS="$(grep -cE "^data/$STORAGE_BUCKET/.*/xl\.meta$" "$TMP/names" || true)"
[ "$OBJECTS" -gt 0 ] || die "arşivde nesne yok"
export OBJECTS
node "$(win "$TMP/check.mjs")" "$(win "$REPO/backend/package.json")" "$(win "$TMP/images")"

# 5. The application itself on the restored data; its own Redis, no workers, no live calls.
# Clean environment and working directory, so neither the shell nor the repository .env leaks in.
# The preload binds it to a free loopback port and reports that port: the answers below can only
# come from this process.
docker run -d --label "$LABEL" --name "$REDIS" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
REDIS_URL="redis://127.0.0.1:$(port "$REDIS" 6379)"
mkdir -p "$TMP/run/cwd"
cat > "$TMP/run/listen.cjs" <<'EOF'
const { Server } = require('node:net');
const { writeFileSync, renameSync } = require('node:fs');
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const file = process.env.DRILL_PORT_FILE;
    writeFileSync(`${file}.part`, String(this.address().port));
    renameSync(`${file}.part`, file);
  });
  const cb = args.find((a) => typeof a === 'function');
  return listen.call(this, { port: 0, host: '127.0.0.1' }, cb);
};
EOF
(cd "$TMP/run/cwd" && exec env -i PATH="$PATH" SYSTEMROOT="${SYSTEMROOT:-}" TEMP="$(win "$TMP")" TMP="$(win "$TMP")" \
  DRILL_PORT_FILE="$(win "$TMP/run")/port" NODE_ENV=development DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" \
  JWT_ACCESS_SECRET="$(rnd)" QUEUE_WORKERS=false SYNC_LIVE_CALLS=false MAIL_TRANSPORT=log \
  STORAGE_ENDPOINT="$STORAGE_ENDPOINT" STORAGE_REGION="$STORAGE_REGION" STORAGE_BUCKET="$STORAGE_BUCKET" \
  STORAGE_ACCESS_KEY="$STORAGE_ACCESS_KEY" STORAGE_SECRET_KEY="$STORAGE_SECRET_KEY" STORAGE_FORCE_PATH_STYLE=true \
  node --require "$(win "$TMP/run/listen.cjs")" "$(win "$REPO/backend/dist/main.js")") > "$TMP/be.log" 2>&1 &
BE=$!
HEALTH=""
for _ in $(seq 1 60); do
  kill -0 "$BE" 2>/dev/null || die "backend kapandı: $(tail -n3 "$TMP/be.log")"
  if [ -s "$TMP/run/port" ]; then
    API="http://127.0.0.1:$(cat "$TMP/run/port")/api/v1"
    HEALTH="$(curl -sf "$API/health")" && break
  fi
  sleep 1
done
case "$HEALTH" in *'"status":"ok"'*'"database":"up"'*) ok "backend /health" ;; *) die "health: $HEALTH" ;; esac
CODE="$(curl -s -w '|%{http_code}' "$API/auth/me")"
[ "${CODE##*|}" = 401 ] || die "yetkisiz istek 401 değil"
ok "toplam $(($(date +%s) - START)) sn (kod: $(git -C "$(win "$REPO")" rev-parse --short HEAD 2>/dev/null || echo bilinmiyor))"
