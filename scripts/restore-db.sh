#!/usr/bin/env bash
#
# **استرجاع نسخة احتياطية** (ج-١٠).
#
# **الافتراضي آمن عمدًا**: من غير `--target`، الاسترجاع بيروح لقاعدة جديدة اسمها
# `baytak_restore_<وقت>` — **مش** فوق القاعدة الشغّالة. ده مقصود: أخطر لحظة في أي كارثة هي
# استرجاع بيمسح البيانات الحالية بالغلط، والاسترجاع للتحقق (اللي المفروض يتعمل شهريًا) مالوش
# أي داعي يلمس الإنتاج أصلاً.
#
# الكتابة فوق قاعدة موجودة محتاجة `--force` **صراحةً** — عشان الأمر ما يتنفّذش من الذاكرة تحت
# ضغط الحادثة.
#
#   scripts/restore-db.sh <ملف.dump> [--target <اسم_القاعدة>] [--force]
#
set -euo pipefail

DUMP="${1:-}"
shift || true
TARGET_DB=""
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET_DB="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "وسيط مش معروف: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "الاستخدام: scripts/restore-db.sh <ملف.dump> [--target اسم] [--force]" >&2
  exit 2
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/api/.env"
  [[ -f "$ENV_FILE" ]] && DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
fi
[[ -z "${DATABASE_URL:-}" ]] && { echo "❌ DATABASE_URL مش متضبط" >&2; exit 2; }

# تفكيك الرابط عشان نقدر نوصل لـ`postgres` (قاعدة الإدارة) ونعمل القاعدة الجديدة.
PROTO_REMOVED="${DATABASE_URL#*://}"
CREDS="${PROTO_REMOVED%%@*}"
HOSTPART="${PROTO_REMOVED#*@}"
PGUSER_="${CREDS%%:*}"
PGPASSWORD_="${CREDS#*:}"
HOSTPORT="${HOSTPART%%/*}"
SOURCE_DB="${HOSTPART#*/}"
SOURCE_DB="${SOURCE_DB%%\?*}"
PGHOST_="${HOSTPORT%%:*}"
PGPORT_="${HOSTPORT#*:}"
[[ "$PGPORT_" == "$PGHOST_" ]] && PGPORT_=5432

export PGPASSWORD="$PGPASSWORD_"
ADMIN_URL="postgres://$PGUSER_@$PGHOST_:$PGPORT_/postgres"

if [[ -z "$TARGET_DB" ]]; then
  TARGET_DB="baytak_restore_$(date -u +%Y%m%d%H%M%S)"
  echo "ℹ  مفيش --target، فالاسترجاع رايح لقاعدة جديدة: $TARGET_DB (القاعدة الشغّالة مش هتتلمس)"
fi

if [[ "$TARGET_DB" == "$SOURCE_DB" && "$FORCE" -ne 1 ]]; then
  echo "❌ ده هيكتب فوق القاعدة الشغّالة ($SOURCE_DB). لو ده المقصود فعلاً ضيف --force." >&2
  exit 1
fi

EXISTS="$(psql "$ADMIN_URL" -Atc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")"
if [[ "$EXISTS" == "1" ]]; then
  if [[ "$FORCE" -ne 1 ]]; then
    echo "❌ القاعدة $TARGET_DB موجودة. --force بيمسحها ويعيد إنشاءها." >&2
    exit 1
  fi
  echo "⚠  بيمسح $TARGET_DB ويعيد إنشاءها (--force)"
  # قطع الاتصالات المفتوحة، وإلا `DROP DATABASE` بيفشل.
  psql "$ADMIN_URL" -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TARGET_DB' AND pid <> pg_backend_pid()" >/dev/null
  psql "$ADMIN_URL" -q -c "DROP DATABASE \"$TARGET_DB\""
fi
psql "$ADMIN_URL" -q -c "CREATE DATABASE \"$TARGET_DB\""

TARGET_URL="postgres://$PGUSER_@$PGHOST_:$PGPORT_/$TARGET_DB"
# الامتدادات لازم تتعمل قبل الاسترجاع — `pg_dump` بيسجّلها بس إنشاءها محتاج صلاحية superuser
# ساعات، ففشلها هنا برسالة واضحة أحسن من فشل غامض في نص الاسترجاع.
psql "$TARGET_URL" -q -c 'CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' >/dev/null 2>&1 || true

START="$(date +%s)"
echo "▶ بيرجّع $DUMP إلى $TARGET_DB ..."
# `--no-owner`: الأدوار مش مضمونة في بيئة الطوارئ. التحذيرات مش أخطاء — `--exit-on-error`
# مقصود إنه **مش** موجود عشان امتداد موجود أصلاً مايوقّفش استرجاع كامل.
pg_restore --dbname="$TARGET_URL" --no-owner --no-privileges --jobs=4 "$DUMP" 2> >(grep -v 'already exists' >&2) || true
ELAPSED=$(( $(date +%s) - START ))

# ===== التحقق: البيانات رجعت فعلاً؟ =====
ROWS="$(psql "$TARGET_URL" -Atc "
  SELECT COALESCE(SUM(n), 0) FROM (
    SELECT (SELECT count(*) FROM users) AS n
    UNION ALL SELECT count(*) FROM orders
    UNION ALL SELECT count(*) FROM payments
  ) t")"
TABLES="$(psql "$TARGET_URL" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"

echo "✅ الاسترجاع خلص في ${ELAPSED}s — $TABLES جدول، $ROWS صف في (users+orders+payments)"
echo "   للفحص: psql '$TARGET_URL'"
echo "$TARGET_DB"
