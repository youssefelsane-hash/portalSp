#!/usr/bin/env bash
#
# **بروفة الـmigrations على نسخة من الإنتاج قبل ما تلمس الإنتاج** (ج-١١).
#
# الفجوة اللي بيقفلها: الـmigrations بتتجرّب على قاعدة تطوير — جداولها فاضية أو فيها عشرات
# الصفوف. الفشل اللي بيهم بيظهر أول مرة على بيانات حقيقية:
#   - `ADD COLUMN … NOT NULL` بيعدّي على جدول فاضي ويفشل على جدول فيه صف واحد.
#   - `CREATE UNIQUE INDEX` بيعدّي محليًا ويفشل على تكرار موجود في الإنتاج بس.
#   - `ALTER TABLE` بياخد ٥٠ مللي على جدول فاضي و٤٠ دقيقة على مليون صف.
#
# السكريبت بياخد **آخر نسخة احتياطية** (أو ملف تحدده)، يرجّعها في قاعدة مؤقتة، يطبّق كل
# الـmigrations المعلّقة عليها، ويقيس **زمن كل واحدة**. النتيجة رقم حقيقي: «الـmigration دي
# هتاخد كذا ثانية على بيانات الإنتاج» بدل تخمين.
#
#   scripts/migration-dry-run.sh [ملف.dump]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${1:-}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  [[ -f "$ROOT/apps/api/.env" ]] && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ROOT/apps/api/.env" | cut -d= -f2-)"
fi
[[ -z "${DATABASE_URL:-}" ]] && { echo "❌ DATABASE_URL مش متضبط" >&2; exit 2; }
export DATABASE_URL

if [[ -z "$DUMP" ]]; then
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/baytak}"
  DUMP="$(ls -t "$BACKUP_DIR"/baytak-*.dump 2>/dev/null | head -1 || true)"
  if [[ -z "$DUMP" ]]; then
    echo "ℹ️  مفيش نسخة جاهزة — بياخد واحدة دلوقتي من القاعدة الحالية."
    TMP_DIR="$(mktemp -d)"
    DUMP="$("$ROOT/scripts/backup-db.sh" "$TMP_DIR" | tail -1)"
    CLEANUP_DUMP_DIR="$TMP_DIR"
  fi
fi
echo "📦 النسخة المستخدمة: $DUMP"

TARGET="$("$ROOT/scripts/restore-db.sh" "$DUMP" | tail -1)"
echo "🗄  البروفة على: $TARGET"

# تفكيك الرابط للقاعدة المؤقتة.
PROTO_REMOVED="${DATABASE_URL#*://}"
CREDS="${PROTO_REMOVED%%@*}"
HOSTPART="${PROTO_REMOVED#*@}"
PGUSER_="${CREDS%%:*}"
export PGPASSWORD="${CREDS#*:}"
HOSTPORT="${HOSTPART%%/*}"
PGHOST_="${HOSTPORT%%:*}"
PGPORT_="${HOSTPORT#*:}"
[[ "$PGPORT_" == "$PGHOST_" ]] && PGPORT_=5432
TARGET_URL="postgres://$PGUSER_@$PGHOST_:$PGPORT_/$TARGET"
ADMIN_URL="postgres://$PGUSER_@$PGHOST_:$PGPORT_/postgres"

cleanup() {
  psql "$ADMIN_URL" -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET' AND pid<>pg_backend_pid()" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS \"$TARGET\"" >/dev/null 2>&1 || true
  [[ -n "${CLEANUP_DUMP_DIR:-}" ]] && rm -rf "$CLEANUP_DUMP_DIR"
}
trap cleanup EXIT

PENDING="$(psql "$TARGET_URL" -Atc "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)"
TOTAL_FILES="$(ls "$ROOT/infra/migrations"/*.sql | wc -l)"
echo "ℹ️  النسخة فيها $PENDING migration مطبّقة، والريبو فيه $TOTAL_FILES ملف."

echo ""
echo "▶ بيطبّق المعلّق على البروفة (بنفس المهل اللي هتتطبّق في الإنتاج) ..."
START="$(date +%s)"
# نفس المشغّل ونفس المهل — بروفة بإعدادات أرخى مش بروفة.
if DATABASE_URL="$TARGET_URL" node "$ROOT/infra/migrations/migrate.js"; then
  ELAPSED=$(( $(date +%s) - START ))
  echo ""
  echo "✅ كل الـmigrations المعلّقة عدّت على نسخة من بيانات الإنتاج في ${ELAPSED}s"
  echo "   الرقم ده هو **الحد الأدنى** المتوقع في الإنتاج (السيرفر هناك تحت حمل كمان)."
  exit 0
else
  echo ""
  echo "❌ الـmigrations فشلت على نسخة من بيانات الإنتاج."
  echo "   ده بالظبط الفشل اللي كان هيحصل وقت النشر — بس هنا **بلا أي أثر على العملاء**."
  exit 1
fi
