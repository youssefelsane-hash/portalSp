#!/usr/bin/env bash
# تشغيل تطبيق Flutter على شاشة وهمية وأخذ لقطة — التحقق البصري الحقيقي (docs/08 §132).
#
# **ليه موجود**: `flutter test` بيختبر المنطق، مش الرندر. بلاغات المالك دايمًا بتيجي كلقطات
# شاشة (overflow، شاشة بيضا، زرار متغطّي) — الحاجات دي مستحيل تتمسك من غير رندر فعلي.
# البيئة كانت ناقصة gtk+3/libsecret فالبناء كان بيفشل، وناقصة fluxbox/xdotool/imagemagick
# فالتفاعل واللقطة ماكانوش ممكنين. `--deps` بيسطّبهم كلهم مرة واحدة.
#
# الاستخدام:
#   scripts/flutter-visual.sh --deps                    سطّب اللي البيئة ناقصاه
#   scripts/flutter-visual.sh customer-app out.png      ابنِ، شغّل، صوّر
#   scripts/flutter-visual.sh technician-app out.png
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:/opt/flutter/bin"
export DISPLAY="${DISPLAY:-:99}"

if [[ "${1:-}" == "--deps" ]]; then
  apt-get update -qq
  # gtk+libsecret للبناء؛ fluxbox **ضروري** (من غير window manager الـxdotool مش موثوق)؛
  # xdotool للتفاعل؛ imagemagick للّقطة.
  apt-get install -y libgtk-3-dev libsecret-1-dev libjsoncpp-dev pkg-config ninja-build \
                     xvfb fluxbox xdotool imagemagick x11-utils
  echo "✅ كل اعتماديات التحقق البصري متسطّبة"; exit 0
fi

APP="${1:?لازم تحدد customer-app أو technician-app}"
OUT="${2:-visual.png}"
DIR="$ROOT/apps/$APP"
BIN_NAME="$(echo "$APP" | tr '-' '_')"

# `CMakeCache.txt` قديمة بتخلّي البناء «ينجح» وهو مركّب في /usr/local بدل bundle — اتلقطت
# فعلاً. مسح دليل البناء بيضمن إعادة ضبط CMake بالـprefix الصح.
[[ -f "$DIR/build/linux/x64/debug/CMakeCache.txt" ]] && ! [[ -d "$DIR/build/linux/x64/debug/bundle" ]] && rm -rf "$DIR/build/linux"
( cd "$DIR" && flutter build linux --debug >/dev/null )

pgrep -f "Xvfb $DISPLAY" >/dev/null || { Xvfb "$DISPLAY" -screen 0 1280x900x24 >/dev/null 2>&1 & sleep 2; }
pgrep -x fluxbox      >/dev/null || { fluxbox >/dev/null 2>&1 & sleep 2; }

"$DIR/build/linux/x64/debug/bundle/$BIN_NAME" >"${TMPDIR:-/tmp}/$BIN_NAME.log" 2>&1 &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null || true' EXIT
sleep 15

import -window root "$OUT"
echo "✅ لقطة: $OUT  |  لوج التطبيق: ${TMPDIR:-/tmp}/$BIN_NAME.log"
echo "   للتفاعل: DISPLAY=$DISPLAY xdotool ...  (التطبيق شغّال بـPID $APP_PID)"
