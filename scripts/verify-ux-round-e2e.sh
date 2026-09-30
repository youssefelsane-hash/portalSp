#!/usr/bin/env bash
# تحقق End-to-End لجولة UX (docs/08 §185) — الأدمن ⇒ تطبيق العميل ⇒ Postgres ⇒ تطبيق الفني.
#
# نصّين Flutter حقيقيين بيشتغلوا على الـAPI وقاعدة البيانات الشغّالين، بالترتيب:
#   ١. apps/customer-app/test_live/ux_round_e2e_live_test.dart   (الأدمن + العميل + الطلب)
#   ٢. apps/technician-app/test_live/ux_round_e2e_live_test.dart (نفس الطلب عند مقدم الخدمة)
# وبعدين بيمسح الخدمة وطلباتها وحسابات الاختبار (الإعدادات بترجع لقيمها من الاختبار نفسه).
#
#   THROTTLE_LIMIT=100000 node dist/main.js   # في apps/api
#   scripts/verify-ux-round-e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${API_BASE_URL:-http://localhost:3000/api/v1}"
export PATH="$PATH:/opt/flutter/bin"
HANDOFF="${TMPDIR:-/tmp}/osta-ux-round-e2e.json"
rm -f "$HANDOFF"
# نفس مصدر الاتصال بتاع الـAPI ونصوص Flutter (`_live_support.dart`) — مفيش اسم قاعدة مكتوب هنا،
# لأن اسم مكتوب بالإيد كان بيوقع السكربت على أي بيئة قاعدتها باسم تاني.
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/apps/api/.env" ]]; then
  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' "$ROOT/apps/api/.env" | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "❌ DATABASE_URL مش متضبط ولا موجود في apps/api/.env" >&2
  exit 1
fi
export DATABASE_URL

cleanup() {
  if [[ -f "$HANDOFF" ]]; then
    local service_id
    service_id="$(node -e "console.log(require('$HANDOFF').service_id)")"
    node "$ROOT/scripts/clean-test-data.js" --service "$service_id" >/dev/null || echo "⚠️ تنظيف الخدمة $service_id ماكملش"
    psql "$DATABASE_URL" -qc \
      "DELETE FROM service_pricing_rules WHERE service_id='$service_id'; DELETE FROM service_pricing_fields WHERE service_id='$service_id'; UPDATE services SET deleted_at = now() WHERE id='$service_id';" >/dev/null || true
    rm -f "$HANDOFF"
  fi
}
trap cleanup EXIT

echo "▶ تطبيق العميل"
(cd "$ROOT/apps/customer-app" && flutter test test_live/ux_round_e2e_live_test.dart --dart-define=API_BASE_URL="$API" --dart-define=UX_E2E_HANDOFF=true)
echo "▶ تطبيق الفني (نفس الطلب)"
(cd "$ROOT/apps/technician-app" && flutter test test_live/ux_round_e2e_live_test.dart --dart-define=API_BASE_URL="$API" --dart-define=UX_E2E_HANDOFF=true)
echo "✅ جولة UX متوصّلة End-to-End"
