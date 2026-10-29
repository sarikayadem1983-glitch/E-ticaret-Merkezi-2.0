#!/usr/bin/env bash
# Backup + restore check + isolated migration rehearsal (spec "Migration güvenliği" 1, 2, 4, 5).
#
# Usage: bash database/scripts/backup-and-rehearse.sh <out-dir>
#   <out-dir> must be outside the repository (the dump holds real user data).
# Produces: <out-dir>/<POSTGRES_DB>-<ts>.dump, restore-check.txt, rehearsal-verify.txt
# Exit 0 only when every check is ok.
#
# Safety:
# - The source database (POSTGRES_DB from .env) is only READ, and only with pg_dump.
# - Every database this script creates or drops starts with tm_ and is never POSTGRES_DB.
# - Only the local docker container tm-postgres / localhost is used.
# - Rehearsal databases are dropped at the end; only the dump and text reports remain.
# - Reports contain counts and check names only, never row contents.
set -euo pipefail
export MSYS_NO_PATHCONV=1

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CONTAINER=tm-postgres
PHASE1=20261029090000_tenant_memberships
BASELINE=20261028140000_companies
VERIFY_DIR="$REPO/database/migrations-verify/20261029090000"
MIGRATION_SQL="$REPO/database/prisma/migrations/$PHASE1/migration.sql"
DB_CHECK=tm_restore_check
DB_REHEARSAL=tm_migration_rehearsal
DB_ROLLBACK=tm_rollback_rehearsal
DB_ROLLBACK_STOP=tm_rollback_stop_rehearsal
DB_ROLLBACK_NULL=tm_rollback_null_rehearsal

die() { echo "HATA: $*" >&2; exit 2; }

# --- arguments / environment ------------------------------------------------
[ $# -eq 1 ] || die "kullanım: $0 <out-dir>"
mkdir -p "$1"
OUT="$(cd "$1" && pwd)"
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
case "$(lc "$OUT")/" in "$(lc "$REPO")"/*) die "out-dir repo içinde olamaz: $OUT" ;; esac

envval() { grep -E "^$1=" "$REPO/.env" | tail -n1 | cut -d= -f2- | tr -d '\r"'; }
SOURCE_DB="$(envval POSTGRES_DB)"
PG_SUPER="$(envval POSTGRES_USER)"
MIG_URL="$(envval MIGRATION_DATABASE_URL)"
[ -n "$SOURCE_DB" ] && [ -n "$PG_SUPER" ] && [ -n "$MIG_URL" ] || die ".env eksik (POSTGRES_DB/POSTGRES_USER/MIGRATION_DATABASE_URL)"

# postgresql://user:pass@host:port/db
MIG_USER="$(printf '%s' "$MIG_URL" | sed -E 's#^postgres(ql)?://([^:]+):.*#\2#')"
MIG_PASS="$(printf '%s' "$MIG_URL" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
MIG_HOST="$(printf '%s' "$MIG_URL" | sed -E 's#^.*@([^:/]+).*#\1#')"
MIG_PORT="$(printf '%s' "$MIG_URL" | sed -E 's#^.*@[^:/]+:([0-9]+)/.*#\1#')"
case "$MIG_HOST" in localhost|127.0.0.1) ;; *) die "yalnızca localhost kabul edilir, bulunan: $MIG_HOST" ;; esac
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true || die "$CONTAINER çalışmıyor"

assert_target() {
  local db="$1"
  case "$db" in tm_*) ;; *) die "hedef adı tm_ ile başlamalı: $db" ;; esac
  [ "$db" != "$SOURCE_DB" ] || die "hedef kaynak veritabanı olamaz: $db"
}
for d in $DB_CHECK $DB_REHEARSAL $DB_ROLLBACK $DB_ROLLBACK_STOP $DB_ROLLBACK_NULL; do assert_target "$d"; done

url_for() { assert_target "$1"; printf 'postgresql://%s:%s@%s:%s/%s' "$MIG_USER" "$MIG_PASS" "$MIG_HOST" "$MIG_PORT" "$1"; }

# --- psql helpers (inside the container) -------------------------------------
# Admin connection: postgres superuser, only to maintenance db "postgres" or tm_* targets.
psql_admin() { local db="$1"; shift; [ "$db" = postgres ] || assert_target "$db"
  docker exec -i "$CONTAINER" psql -U "$PG_SUPER" -d "$db" -X -q -v ON_ERROR_STOP=1 -At "$@"; }
# Migrator connection to a tm_* target.
psql_mig() { local db="$1"; shift; assert_target "$db"
  docker exec -i -e PGPASSWORD="$MIG_PASS" "$CONTAINER" psql -h localhost -U "$MIG_USER" -d "$db" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

drop_db() { assert_target "$1"; echo ">> HEDEF DB: $1 (DROP)"; psql_admin postgres -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)"; }
create_db() { assert_target "$1"; echo ">> HEDEF DB: $1 (CREATE${2:+ TEMPLATE $2})"
  if [ -n "${2:-}" ]; then assert_target "$2"; psql_admin postgres -c "CREATE DATABASE \"$1\" TEMPLATE \"$2\""
  else psql_admin postgres -c "CREATE DATABASE \"$1\""; fi
  psql_admin postgres -c "GRANT CONNECT ON DATABASE \"$1\" TO tm_app, $MIG_USER"; }
restore_into() { assert_target "$1"; echo ">> HEDEF DB: $1 (pg_restore)"
  docker exec -i "$CONTAINER" pg_restore -U "$PG_SUPER" -d "$1" --exit-on-error < "$DUMP"; }

cleanup() { set +e; for d in $DB_CHECK $DB_REHEARSAL $DB_ROLLBACK $DB_ROLLBACK_STOP $DB_ROLLBACK_NULL; do drop_db "$d" >/dev/null 2>&1; done; }
trap cleanup EXIT

# Verifies through the exact URL handed to prisma that it reaches the rehearsal db.
assert_url_db() {
  local got
  got="$(cd "$REPO/backend" && CHECK_URL="$1" node -e '
    const pg = require("pg"); const c = new pg.Client({ connectionString: process.env.CHECK_URL });
    c.connect().then(() => c.query("select current_database() as d")).then(r => { console.log(r.rows[0].d); return c.end(); })
     .catch(e => { console.error(e.message); process.exit(1); });')"
  [ "$got" = "$2" ] || die "URL beklenen veritabanına gitmiyor (beklenen $2, bulunan $got)"
  echo ">> current_database() = $got (doğrulandı)" >&2
}

prisma_deploy() {
  local url; url="$(url_for "$1")"
  assert_url_db "$url" "$1"
  echo ">> HEDEF DB: $1 (prisma migrate deploy)" >&2
  (cd "$REPO/backend" && DATABASE_URL="$url" MIGRATION_DATABASE_URL="$url" npx prisma migrate deploy 2>&1)
}

# --- report helpers ------------------------------------------------------------
FAILS=0
REPORT="$OUT/rehearsal-verify.txt"
RESTORE_REPORT="$OUT/restore-check.txt"
check() { # name ok(t/f) detail
  printf '%-40s ok=%s  %s\n' "$1" "$2" "$3" >> "$REPORT"
  [ "$2" = t ] || FAILS=$((FAILS + 1))
}
section() { printf '\n== %s ==\n' "$1" >> "$REPORT"; }
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

# Fingerprint: per-table row counts + column list + _prisma_migrations rows.
FINGERPRINT_SQL="
SELECT md5(
  (SELECT string_agg(t.table_name || '=' ||
     (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text, ',' ORDER BY t.table_name)
   FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE')
  || '|' || (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, column_name)
   FROM information_schema.columns WHERE table_schema = 'public')
  || '|' || (SELECT string_agg(migration_name || ':' || checksum || ':' || coalesce(finished_at::text, '-'), ',' ORDER BY migration_name) FROM _prisma_migrations));"
USERS_SQL="SELECT count(*) || '|' || md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM users;"
LATEST_SQL="SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1;"

TS="$(date +%Y%m%d-%H%M%S)"
DUMP="$OUT/$SOURCE_DB-$TS.dump"
: > "$REPORT"; : > "$RESTORE_REPORT"
{
  echo "Migration rehearsal — $PHASE1"
  echo "Kaynak: $SOURCE_DB (yalnızca pg_dump ile okundu)  Zaman: $TS"
  echo "Satır içerikleri yazılmaz; yalnızca sayılar ve kontrol adları."
} >> "$REPORT"
cleanup

# --- 1. backup (the only access to the source db) ------------------------------
echo ">> KAYNAK DB: $SOURCE_DB (yalnızca pg_dump, okuma)"
docker exec "$CONTAINER" pg_dump -U "$PG_SUPER" -d "$SOURCE_DB" -Fc > "$DUMP"
[ -s "$DUMP" ] || die "dump boş"
TOC_ENTRIES="$(docker exec -i "$CONTAINER" pg_restore --list < "$DUMP" | grep -cv '^;')"

# --- 2. restore check ----------------------------------------------------------
create_db $DB_CHECK
restore_into $DB_CHECK
DUMP_COUNTS="$(docker exec -i "$CONTAINER" pg_restore --data-only -f - < "$DUMP" | awk '
  /^COPY public\./ { t=$2; sub(/^public\./, "", t); gsub(/"/, "", t); n=0; inside=1; next }
  inside && /^\\\.$/ { print t "|" n; inside=0; next }
  inside { n++ }' | sort)"
RESTORED_COUNTS="$(psql_admin $DB_CHECK -c "
  SELECT t.table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.table_name), false, true, '')))[1]::text
  FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' ORDER BY 1;" | sort)"
{
  echo "Restore check — dump: $(basename "$DUMP") ($(wc -c < "$DUMP") bayt, pg_restore --list: $TOC_ENTRIES kayıt)"
  echo "tablo|dump_satır|geri_yüklenen_satır"
  join -t'|' -a1 -a2 -e MISSING -o 0,1.2,2.2 <(echo "$DUMP_COUNTS") <(echo "$RESTORED_COUNTS")
} >> "$RESTORE_REPORT"
section "1. Yedek ve geri yükleme"
check backup_toc_readable "$([ "$TOC_ENTRIES" -gt 0 ] && echo t || echo f)" "pg_restore --list kayıt=$TOC_ENTRIES"
if [ "$DUMP_COUNTS" = "$RESTORED_COUNTS" ]; then
  check restore_row_counts_match t "tablo=$(echo "$RESTORED_COUNTS" | wc -l) (ayrıntı: restore-check.txt)"
else
  check restore_row_counts_match f "farklar restore-check.txt içinde"
fi
echo "sonuç: $([ "$DUMP_COUNTS" = "$RESTORED_COUNTS" ] && echo ok || echo FARK)" >> "$RESTORE_REPORT"
drop_db $DB_CHECK

# --- 3. rehearsal ----------------------------------------------------------------
create_db $DB_REHEARSAL
restore_into $DB_REHEARSAL
section "2. Migration öncesi ($DB_REHEARSAL)"
BEFORE_LATEST="$(psql_admin $DB_REHEARSAL -c "$LATEST_SQL")"
check baseline_is_companies "$([ "$BEFORE_LATEST" = "$BASELINE" ] && echo t || echo f)" "son_migration=$BEFORE_LATEST"
USERS_BEFORE="$(psql_admin $DB_REHEARSAL -c "$USERS_SQL")"
COLLISIONS="$(psql_admin $DB_REHEARSAL -c "SELECT count(*) FROM (SELECT lower(email) FROM users GROUP BY 1 HAVING count(*) > 1) x;")"
COLLISION_ROWS="$(psql_admin $DB_REHEARSAL -c "SELECT coalesce(sum(c), 0) FROM (SELECT count(*) c FROM users GROUP BY lower(email) HAVING count(*) > 1) x;")"
check email_case_collisions "$([ "$COLLISIONS" = 0 ] && echo t || echo f)" "çakışan_grup=$COLLISIONS etkilenen_kullanıcı=$COLLISION_ROWS (birleştirme yapılmaz)"
echo "kullanıcı_sayısı=${USERS_BEFORE%%|*}" >> "$REPORT"
echo ">> HEDEF DB: $DB_REHEARSAL (snapshot-before.sql)"
psql_mig $DB_REHEARSAL < "$VERIFY_DIR/snapshot-before.sql"

section "3. prisma migrate deploy ($DB_REHEARSAL)"
T0="$(now_ms)"
DEPLOY_OUT="$(prisma_deploy $DB_REHEARSAL)" || { echo "$DEPLOY_OUT" | grep -v -i 'postgresql://' >&2; check migrate_deploy f "başarısız"; exit 1; }
T1="$(now_ms)"
MIG_MS=$((T1 - T0))
check migrate_deploy "$(echo "$DEPLOY_OUT" | grep -q "$PHASE1" && echo t || echo f)" "uygulandı=$PHASE1 süre_ms=$MIG_MS (prisma CLI başlangıcı dahil)"
APPLY_MS="$(psql_admin $DB_REHEARSAL -c "SELECT round(extract(epoch FROM finished_at - started_at) * 1000) FROM _prisma_migrations WHERE migration_name = '$PHASE1';")"
echo "migration_süresi_ms (veritabanı, started_at..finished_at)=$APPLY_MS" >> "$REPORT"
echo "migration_süresi_ms (prisma migrate deploy toplam)=$MIG_MS" >> "$REPORT"

section "4. verify-after.sql"
VERIFY_OUT="$(psql_mig $DB_REHEARSAL -F '|' < "$VERIFY_DIR/verify-after.sql")"
while IFS='|' read -r name ok detail; do
  [ -n "$name" ] || continue
  [ "$name" = roles_without_key ] && detail="${detail%% (*}"   # names omitted
  check "$name" "$ok" "$detail"
done <<< "$VERIFY_OUT"

section "5. Kullanıcı ve eşleşme kontrolleri"
USERS_AFTER="$(psql_admin $DB_REHEARSAL -c "$USERS_SQL")"
check user_count_unchanged "$([ "${USERS_BEFORE%%|*}" = "${USERS_AFTER%%|*}" ] && echo t || echo f)" "önce=${USERS_BEFORE%%|*} sonra=${USERS_AFTER%%|*}"
check user_id_set_equal "$([ "${USERS_BEFORE#*|}" = "${USERS_AFTER#*|}" ] && echo t || echo f)" "id kümesi md5 karşılaştırması"
MAP="$(psql_admin $DB_REHEARSAL -c "SELECT (SELECT count(*) FROM tenant_memberships) || '|' ||
  (SELECT count(*) FROM users u WHERE (SELECT count(*) FROM tenant_memberships m WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id) <> 1) || '|' ||
  (SELECT count(*) FROM tenant_memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id IS DISTINCT FROM u.tenant_id);")"
IFS='|' read -r M_TOTAL M_BAD M_FOREIGN <<< "$MAP"
check tenant_membership_mapping "$([ "$M_BAD" = 0 ] && [ "$M_FOREIGN" = 0 ] && [ "$M_TOTAL" = "${USERS_AFTER%%|*}" ] && echo t || echo f)" "üyelik=$M_TOTAL eşleşmeyen_kullanıcı=$M_BAD başka_tenant=$M_FOREIGN"
OWN="$(psql_admin $DB_REHEARSAL -c "SELECT (SELECT count(*) FROM _mig_snapshot_user_roles WHERE role_name = 'owner') || '|' ||
  (SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'owner') || '|' ||
  (SELECT count(*) FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.tenant_id = t.id AND r.key = 'owner'));")"
IFS='|' read -r O_BEFORE O_AFTER O_MISSING <<< "$OWN"
check owner_mapping "$([ "$O_BEFORE" = "$O_AFTER" ] && echo t || echo f)" "owner_atama önce=$O_BEFORE sonra(key=owner)=$O_AFTER owner'sız_tenant=$O_MISSING"
ROLES="$(psql_admin $DB_REHEARSAL -c "SELECT (SELECT count(*) FROM _mig_snapshot_user_roles) || '|' || (SELECT count(*) FROM user_roles) || '|' ||
  (SELECT count(*) FROM _mig_snapshot_user_company_roles) || '|' || (SELECT count(*) FROM user_company_roles);")"
IFS='|' read -r R_B R_A C_B C_A <<< "$ROLES"
check role_assignment_counts "$([ "$R_B" = "$R_A" ] && echo t || echo f)" "user_roles önce=$R_B sonra=$R_A"
check company_role_assignment_counts "$([ "$C_B" = "$C_A" ] && echo t || echo f)" "user_company_roles önce=$C_B sonra=$C_A"

section "6. Tekrar çalıştırma (idempotency)"
FP1="$(psql_admin $DB_REHEARSAL -c "$FINGERPRINT_SQL")"
DEPLOY2="$(prisma_deploy $DB_REHEARSAL)" || { check second_deploy_noop f "ikinci deploy hata verdi"; DEPLOY2=""; }
FP2="$(psql_admin $DB_REHEARSAL -c "$FINGERPRINT_SQL")"
check second_deploy_noop "$(echo "$DEPLOY2" | grep -qi 'No pending migrations' && [ "$FP1" = "$FP2" ] && echo t || echo f)" "çıktı='No pending migrations', parmak izi değişmedi=$([ "$FP1" = "$FP2" ] && echo evet || echo HAYIR)"
echo ">> HEDEF DB: $DB_REHEARSAL (migration.sql doğrudan tekrar, hata beklenir)"
set +e
RERUN_ERR="$(psql_mig $DB_REHEARSAL -1 < "$MIGRATION_SQL" 2>&1 >/dev/null)"; RERUN_RC=$?
set -e
FP3="$(psql_admin $DB_REHEARSAL -c "$FINGERPRINT_SQL")"
RERUN_KIND="$(echo "$RERUN_ERR" | grep -o 'already exists' | head -n1)"
check direct_rerun_fails_no_change "$([ "$RERUN_RC" -ne 0 ] && [ "$FP1" = "$FP3" ] && echo t || echo f)" "psql çıkış=$RERUN_RC hata_türü='${RERUN_KIND:-diğer}' parmak izi değişmedi=$([ "$FP1" = "$FP3" ] && echo evet || echo HAYIR)"
VERIFY_AGAIN="$(psql_mig $DB_REHEARSAL -F '|' < "$VERIFY_DIR/verify-after.sql" | awk -F'|' '$2 != "t"' | wc -l)"
check verify_after_still_ok "$([ "$VERIFY_AGAIN" = 0 ] && echo t || echo f)" "başarısız_satır=$VERIFY_AGAIN"

# --- 4. rollback rehearsal on separate copies ------------------------------------
section "7. Geri dönüş provası ($DB_ROLLBACK, migrate edilmiş kopyadan)"
create_db $DB_ROLLBACK $DB_REHEARSAL
echo ">> HEDEF DB: $DB_ROLLBACK (rollback.sql)"
set +e; psql_mig $DB_ROLLBACK < "$VERIFY_DIR/rollback.sql" >/dev/null 2>&1; RB_RC=$?; set -e
check rollback_succeeds "$([ "$RB_RC" = 0 ] && echo t || echo f)" "psql çıkış=$RB_RC"
RB="$(psql_admin $DB_ROLLBACK -c "SELECT (to_regclass('public.tenant_memberships') IS NULL) || '|' ||
  (to_regclass('public.invitations') IS NULL) || '|' ||
  (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'tenant_id') || '|' ||
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'roles' AND column_name IN ('key', 'scope', 'is_system'));")"
IFS='|' read -r RB_TM RB_INV RB_NULL RB_COLS <<< "$RB"
check rollback_schema_restored "$([ "$RB_TM" = true ] && [ "$RB_INV" = true ] && [ "$RB_NULL" = NO ] && [ "$RB_COLS" = 0 ] && echo t || echo f)" "tablolar_kaldırıldı=$RB_TM/$RB_INV users.tenant_id_nullable=$RB_NULL roles_yeni_kolon=$RB_COLS"
RB_LATEST="$(psql_admin $DB_ROLLBACK -c "$LATEST_SQL")"
check rollback_migration_history "$([ "$RB_LATEST" = "$BASELINE" ] && echo t || echo f)" "son_migration=$RB_LATEST"
RB_USERS="$(psql_admin $DB_ROLLBACK -c "$USERS_SQL")"
RB_ACTIVE="$(psql_admin $DB_ROLLBACK -c "SELECT count(*) FROM _mig_snapshot_users s LEFT JOIN users u ON u.id = s.id WHERE u.id IS NULL OR u.tenant_id IS DISTINCT FROM s.tenant_id OR u.is_active IS DISTINCT FROM s.is_active OR md5(u.password_hash) <> s.password_md5;")"
check rollback_users_preserved "$([ "$RB_USERS" = "$USERS_BEFORE" ] && [ "$RB_ACTIVE" = 0 ] && echo t || echo f)" "kullanıcı=${RB_USERS%%|*} id kümesi eşit=$([ "$RB_USERS" = "$USERS_BEFORE" ] && echo evet || echo HAYIR) farklı_tenant/durum/hash=$RB_ACTIVE"
RB_ROLES="$(psql_admin $DB_ROLLBACK -c "SELECT (SELECT count(*) FROM ((SELECT tenant_id, user_id, role_id FROM _mig_snapshot_user_roles EXCEPT SELECT tenant_id, user_id, role_id FROM user_roles)
  UNION ALL (SELECT tenant_id, user_id, role_id FROM user_roles EXCEPT SELECT tenant_id, user_id, role_id FROM _mig_snapshot_user_roles)) x) + (SELECT count(*) FROM (
  (SELECT tenant_id, user_id, company_id, role_id FROM _mig_snapshot_user_company_roles EXCEPT SELECT tenant_id, user_id, company_id, role_id FROM user_company_roles)
  UNION ALL (SELECT tenant_id, user_id, company_id, role_id FROM user_company_roles EXCEPT SELECT tenant_id, user_id, company_id, role_id FROM _mig_snapshot_user_company_roles)) y);")"
check rollback_assignments_preserved "$([ "$RB_ROLES" = 0 ] && echo t || echo f)" "fark=$RB_ROLES"
drop_db $DB_ROLLBACK

section "8. Geri dönüş durma koşulu ($DB_ROLLBACK_STOP, ikinci üyelik eklenmiş kopya)"
create_db $DB_ROLLBACK_STOP $DB_REHEARSAL
echo ">> HEDEF DB: $DB_ROLLBACK_STOP (ikinci tenant + bir kullanıcıya ikinci üyelik)"
psql_admin $DB_ROLLBACK_STOP -c "
  INSERT INTO tenants (id, name, slug, updated_at) VALUES ('00000000-0000-4000-8000-00000000beef', 'rehearsal-second', 'rehearsal-second-tenant', now());
  INSERT INTO tenant_memberships (tenant_id, user_id, status, updated_at)
    SELECT '00000000-0000-4000-8000-00000000beef', id, 'active', now() FROM users ORDER BY id LIMIT 1;"
STOP_BEFORE="$(psql_admin $DB_ROLLBACK_STOP -c "SELECT count(*) FROM tenant_memberships;")"
set +e; STOP_ERR="$(psql_mig $DB_ROLLBACK_STOP < "$VERIFY_DIR/rollback.sql" 2>&1 >/dev/null)"; STOP_RC=$?; set -e
STOP_AFTER="$(psql_admin $DB_ROLLBACK_STOP -c "SELECT count(*) FROM tenant_memberships;")"
STOP_MSG="$(echo "$STOP_ERR" | grep -o 'rollback durdu: [^0-9]*' | head -n1 | sed 's/ *$//')"
check rollback_stops_on_multi_tenant "$([ "$STOP_RC" -ne 0 ] && echo "$STOP_ERR" | grep -q 'birden fazla tenant' && [ "$STOP_BEFORE" = "$STOP_AFTER" ] && echo t || echo f)" "psql çıkış=$STOP_RC mesaj='${STOP_MSG:-yok}' üyelik önce=$STOP_BEFORE sonra=$STOP_AFTER (hiçbir şey değişmedi)"
drop_db $DB_ROLLBACK_STOP

section "9. Geri dönüş durma koşulu ($DB_ROLLBACK_NULL, tenant_id'siz kullanıcı eklenmiş kopya)"
create_db $DB_ROLLBACK_NULL $DB_REHEARSAL
echo ">> HEDEF DB: $DB_ROLLBACK_NULL (tenant_id NULL global kullanıcı, davetle oluşmuş gibi)"
psql_admin $DB_ROLLBACK_NULL -c "
  INSERT INTO users (id, tenant_id, name, email, password_hash, updated_at)
  VALUES ('00000000-0000-4000-8000-00000000cafe', NULL, 'rehearsal-invited', 'rehearsal-invited@example.invalid', 'x', now());"
NULL_FP1="$(psql_admin $DB_ROLLBACK_NULL -c "$FINGERPRINT_SQL")"
set +e; NULL_ERR="$(psql_mig $DB_ROLLBACK_NULL < "$VERIFY_DIR/rollback.sql" 2>&1 >/dev/null)"; NULL_RC=$?; set -e
NULL_FP2="$(psql_admin $DB_ROLLBACK_NULL -c "$FINGERPRINT_SQL")"
NULL_VERIFY="$(psql_mig $DB_ROLLBACK_NULL -F '|' < "$VERIFY_DIR/verify-after.sql" | awk -F'|' '$2 != "t"' | wc -l)"
NULL_MSG="$(echo "$NULL_ERR" | grep -o 'rollback durdu: tenant_id olmayan' | head -n1)"
check rollback_stops_on_null_tenant_user "$([ "$NULL_RC" -ne 0 ] && [ -n "$NULL_MSG" ] && [ "$NULL_FP1" = "$NULL_FP2" ] && [ "$NULL_VERIFY" = 0 ] && echo t || echo f)" "psql çıkış=$NULL_RC mesaj='${NULL_MSG:-yok}' parmak izi değişmedi=$([ "$NULL_FP1" = "$NULL_FP2" ] && echo evet || echo HAYIR) verify-after başarısız_satır=$NULL_VERIFY"
drop_db $DB_ROLLBACK_NULL
drop_db $DB_REHEARSAL

section "Sonuç"
TOTAL="$(grep -c ' ok=' "$REPORT")"
echo "kontrol=$TOTAL başarısız=$FAILS" >> "$REPORT"
echo "dump: $DUMP"
echo "rapor: $REPORT"
echo "restore: $RESTORE_REPORT"
cat "$REPORT"
[ "$FAILS" = 0 ] || exit 1
