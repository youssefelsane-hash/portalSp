#!/usr/bin/env bash
#
# **نسخة احتياطية للقاعدة — بالتحقق، مش بالأمل** (ج-١٠).
#
# النسخة الاحتياطية اللي محدش تأكد إنها بتترجّع **مش نسخة احتياطية** — هي ملف على قرص. نص
# حوادث فقدان البيانات الحقيقية سببها إن النسخ كانت بتتاخد يوميًا لشهور وأول مرة حد جرّب
# يرجّعها كانت وقت الكارثة. عشان كده كل نسخة هنا بتعدّي على `pg_restore --list` قبل ما تتعتبر
# ناجحة: ده بيقرا فهرس الأرشيف فعلاً، فملف مقطوع أو تالف بيفشل هنا مش بعد سنة.
#
# `--format=custom` مقصود (مش SQL خام): بيسمح باسترجاع انتقائي (جدول واحد)، وبيتضغط، و`pg_restore`
# بيقدر يقرا فهرسه للتحقق.
#
#   scripts/backup-db.sh [مجلد_الهدف]
#
# متغيّرات: `DATABASE_URL` (إجباري)، `BACKUP_RETENTION_DAYS` (افتراضي ١٤).
#
# **التشغيل الدوري** مسؤولية طبقة النشر (cron/systemd timer) مش السكريبت — نموذج في
# `infra/systemd/baytak-backup.service` و`.timer`.
set -euo pipefail

BACKUP_DIR="${1:-${BACKUP_DIR:-/var/backups/baytak}}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  # نفس مصدر باقي أدوات المشروع — الملف مستبعد من Git فمفيش سر بيتسرّب.
  ENV_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/api/.env"
  if [[ -f "$ENV_FILE" ]]; then
    DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
  fi
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL مش متضبط ولا موجود في apps/api/.env" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="$BACKUP_DIR/baytak-$STAMP.dump"

echo "▶ بياخد نسخة إلى $DUMP"
# `--no-owner`/`--no-privileges`: الاسترجاع لازم ينجح على سيرفر بأدوار مختلفة (بيئة الطوارئ
# غالبًا مش نسخة طبق الأصل من الإنتاج). ملكية الجداول بتتحدد وقت الاسترجاع مش وقت النسخ.
pg_dump "$DATABASE_URL" --format=custom --compress=6 --no-owner --no-privileges --file="$DUMP"

# ===== التحقق — الجزء اللي بيفرّق نسخة عن ملف =====
if ! pg_restore --list "$DUMP" > "$DUMP.toc" 2>/dev/null; then
  echo "❌ الأرشيف تالف — pg_restore --list فشل. النسخة دي **مش صالحة**." >&2
  rm -f "$DUMP" "$DUMP.toc"
  exit 1
fi

# جداول جوهرية لازم تكون في الفهرس. أرشيف «نجح» وهو فاضي (اتصال غلط، schema فاضية) بيعدّي
# على `--list` عادي — ده الفحص اللي بيمسكه.
MISSING=""
for table in orders users payments wallet_transactions technician_profiles; do
  grep -q "TABLE DATA public $table " "$DUMP.toc" || MISSING="$MISSING $table"
done
if [[ -n "$MISSING" ]]; then
  echo "❌ النسخة ناقصة جداول جوهرية:$MISSING — أرشيف فاضي أو ناقص." >&2
  exit 1
fi

SIZE_BYTES="$(stat -c%s "$DUMP")"
SHA="$(sha256sum "$DUMP" | cut -d' ' -f1)"
TABLES="$(grep -c 'TABLE DATA public' "$DUMP.toc" || true)"

cat > "$DUMP.manifest.json" <<JSON
{
  "file": "$(basename "$DUMP")",
  "taken_at": "$STAMP",
  "size_bytes": $SIZE_BYTES,
  "sha256": "$SHA",
  "tables_with_data": $TABLES,
  "pg_dump_version": "$(pg_dump --version | awk '{print $3}')",
  "verified": "pg_restore --list نجح + الجداول الجوهرية موجودة"
}
JSON
rm -f "$DUMP.toc"

echo "✅ النسخة سليمة — $((SIZE_BYTES / 1024)) كيلوبايت، $TABLES جدول، sha256=${SHA:0:16}…"

# ===== الاحتفاظ =====
# الحذف بيحصل **بعد** ما النسخة الجديدة اتأكدت — عشان فشل النسخ مايمسحش آخر نسخة سليمة.
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name 'baytak-*.dump' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
find "$BACKUP_DIR" -maxdepth 1 -name 'baytak-*.dump.manifest.json' -mtime "+$RETENTION_DAYS" -delete
[[ "$DELETED" -gt 0 ]] && echo "🗑  اتمسح $DELETED نسخة أقدم من $RETENTION_DAYS يوم"

echo "$DUMP"
