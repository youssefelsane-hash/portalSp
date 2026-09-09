#!/usr/bin/env bash
# تشغيل/إعادة تشغيل نسخة **واحدة** من الـAPI المبنية، والانتظار لحد ما ترد فعلاً.
#
# الاحتكاك اللي بيحلّه: تشغيل الـAPI في الخلفية من سطر أوامر مركّب بيسيب نسخ زيادة أو يقتل
# النسخة الشغّالة بالغلط، وقياسات الحِمل بعدها بتبقى بلا معنى (اتلقط حيًا: «٨٠ من ٨٠ فشلوا»
# طلع سببه إن السيرفر مكانش شغّال أصلاً، مش انهيار تحت الضغط).
#
#   scripts/dev-api.sh [start|stop|restart]   — متغيرات البيئة بتتمرر زي ما هي
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/api" && pwd)"
LOG="$API_DIR/.dev-logs/api.out"
URL="${API_BASE_URL:-http://localhost:3000/api/v1}/branding"

stop_api() {
  local pids
  pids="$(pgrep -f 'node \./dist/main\.js' || true)"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  # الانتظار لحد ما البورت يتساب فعلاً — البدء فورًا بيقع على EADDRINUSE.
  for _ in $(seq 1 20); do
    pgrep -f 'node \./dist/main\.js' >/dev/null || return 0
    sleep 0.5
  done
}

start_api() {
  mkdir -p "$API_DIR/.dev-logs"
  ( cd "$API_DIR" && setsid node ./dist/main.js > "$LOG" 2>&1 < /dev/null & )
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)" = "200" ]; then
      echo "API شغّال — pool: $(grep -a 'سعة الاتصالات' "$LOG" | tail -1 | sed 's/.*pool النسخة دي //; s/،.*//')"
      return 0
    fi
    sleep 1
  done
  echo "الـAPI مابقاش بيرد خلال ٦٠ ثانية. آخر سطور اللوج:" >&2
  tail -20 "$LOG" >&2
  return 1
}

case "${1:-restart}" in
  start)   start_api ;;
  stop)    stop_api ;;
  restart) stop_api; start_api ;;
  *)       echo "الاستخدام: $0 [start|stop|restart]" >&2; exit 1 ;;
esac
