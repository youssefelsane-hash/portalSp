#!/usr/bin/env bash
# بناء نسختَي Google Play (العميل + الفني) **والتحقق منهم قبل الرفع** — بأمر واحد.
#
# ── ليه موجود ────────────────────────────────────────────────────────────────────────────
# 1.0.7+8 اتبنت من غير `--dart-define=API_BASE_URL`، فاتشحنت بعنوان محاكي أندرويد
# (`10.0.2.2`). البناء **نجح** عادي، والرفع نجح، والنتيجة على موبايل المالك: الـsplash ثابت
# و«التطبيق لا يستجيب» على التطبيقين. ولا خطوة من دول قالت إن فيه حاجة غلط.
#
# السكربت ده بيقفل الطريق ده من الناحيتين:
#   ١) بيبني بالعنوان الصح دايمًا (مش معتمد على إن حد يفتكر الـflag).
#   ٢) **بيفتح الـAAB الناتج ويتأكد** إن عنوان الإنتاج متخبّز جوّه الكود المترجم فعلاً وعنوان
#      التطوير مش موجود — نفس الفحص اللي كان هيمسك 1.0.7+8 قبل ما تترفع.
#
# (وفيه كمان حارس في `android/app/build.gradle.kts` بيرفض أي بناء release بلا العنوان — ده
#  بيحمي حتى لو حد بنى من غير السكربت ده.)
#
# ── الاستخدام ────────────────────────────────────────────────────────────────────────────
#   scripts/build-play-release.sh                 # الاتنين
#   scripts/build-play-release.sh customer        # العميل بس
#   scripts/build-play-release.sh technician      # الفني بس
#   scripts/build-play-release.sh all --apk      # + APK تتسطّب على الموبايل مباشرةً للتجربة قبل الرفع
#
#   API_BASE_URL=https://… scripts/build-play-release.sh   # لو عنوان الـAPI اتغيّر
#
# ── المتطلبات على جهاز البناء (**مش** في Git، ومش هتتطبع أبدًا) ─────────────────────────
#   apps/<app>/android/key.properties  + ملف الـkeystore اللي بيشاور عليه  (توقيع الرفع)
#   apps/customer-app/android/maps.properties                              (مفتاح الخرائط)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-https://api.ostahome.com/api/v1}"
DEV_DEFAULT_URL="http://10.0.2.2:3000/api/v1"
TARGET="${1:-all}"
WITH_APK="false"
[[ "${2:-}" == "--apk" || "${1:-}" == "--apk" ]] && WITH_APK="true"
[[ "$TARGET" == "--apk" ]] && TARGET="all"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
fail()  { red "❌ $*"; exit 1; }

command -v flutter >/dev/null || fail "flutter مش في الـPATH"
command -v unzip   >/dev/null || fail "unzip مش متسطّب"
command -v strings >/dev/null || fail "strings مش متسطّب (binutils)"

case "$API_BASE_URL" in
  https://*) ;;
  *) fail "API_BASE_URL لازم يبدأ بـhttps:// — القيمة الحالية: $API_BASE_URL" ;;
esac
case "$API_BASE_URL" in
  *10.0.2.2*|*localhost*|*127.0.0.1*) fail "API_BASE_URL عنوان تطوير محلي: $API_BASE_URL" ;;
esac

case "$TARGET" in
  all)        APPS=(customer technician) ;;
  customer)   APPS=(customer) ;;
  technician) APPS=(technician) ;;
  *) fail "الاستخدام: $0 [all|customer|technician]" ;;
esac

OUT_ROOT="$ROOT/dist/play"
mkdir -p "$OUT_ROOT"
declare -a RESULTS=()

# بيفتح الأرشيف (AAB أو APK) ويتأكد إن عنوان الإنتاج **متخبّز جوّه الكود المترجم** وعنوان
# التطوير مش موجود. `String.fromEnvironment` بيتحوّل لثابت وقت الترجمة، فالعنوان بيبقى نص
# صريح جوّه `libapp.so` — اتأكد عمليًا على النسختين السليمة والمكسورة قبل ما السكربت يتكتب.
verify_artifact() {
  local short="$1" archive="$2" inner="$3" kind="${2##*.}"
  local tmp
  tmp="$(mktemp -d)"
  unzip -q -o "$archive" "$inner" -d "$tmp" \
    || { rm -rf "$tmp"; fail "$short: مفيش libapp.so لـarm64 جوّه الـ$kind — النسخة مش هتشتغل على أغلب الموبايلات"; }
  # النصوص بتتستخرج **لملف** مرة واحدة، مش `strings | grep -q`: مع `set -o pipefail`، `grep -q`
  # بيقفل أول ما يلاقي تطابق، فـ`strings` بياخد SIGPIPE والـpipeline كلها بتتحسب **فاشلة** —
  # يعني النسخة السليمة كانت بتترفض. اتلقطت في اختبار السكربت نفسه قبل ما يوصل لحد.
  strings -n 8 "$tmp/$inner" > "$tmp/strings.txt"
  if ! grep -qF "$API_BASE_URL" "$tmp/strings.txt"; then
    rm -rf "$tmp"; fail "$short: عنوان الإنتاج ($API_BASE_URL) **مش موجود** جوّه الكود المترجم للـ$kind — ماترفعش النسخة دي"
  fi
  if grep -qF "$DEV_DEFAULT_URL" "$tmp/strings.txt"; then
    rm -rf "$tmp"; fail "$short: عنوان التطوير ($DEV_DEFAULT_URL) موجود جوّه الـ$kind — دي بالظبط بَقّة 1.0.7+8، ماترفعش"
  fi
  rm -rf "$tmp"
}

build_one() {
  local short="$1"
  local dir="$ROOT/apps/${short}-app"
  local version
  version="$(grep -E '^version:' "$dir/pubspec.yaml" | awk '{print $2}')"
  local name="${version%%+*}" code="${version##*+}"

  echo
  echo "━━━ ${short} — ${name} (versionCode ${code}) ━━━"

  # ── متطلبات قبل البناء — بنفحص **وجود** الملفات بس، ومفيش قيمة واحدة منها بتتطبع ──
  local keyprops="$dir/android/key.properties"
  [[ -f "$keyprops" ]] || fail "$short: مفيش android/key.properties — نسخة المتجر لازم تتوقّع بمفتاح الرفع الحقيقي"
  local store
  store="$(grep -E '^storeFile=' "$keyprops" | cut -d= -f2- | tr -d '\r')"
  [[ -n "$store" ]] || fail "$short: key.properties مافيهوش storeFile"
  ( cd "$dir/android/app" && [[ -f "$store" ]] ) || fail "$short: ملف الـkeystore اللي key.properties بيشاور عليه مش موجود"
  if [[ "$short" == "customer" ]]; then
    [[ -f "$dir/android/maps.properties" ]] || fail "customer: مفيش android/maps.properties (مفتاح Google Maps)"
  fi

  # ── البناء ──
  ( cd "$dir" && flutter build appbundle --release \
      --dart-define=API_BASE_URL="$API_BASE_URL" )

  local aab="$dir/build/app/outputs/bundle/release/app-release.aab"
  [[ -f "$aab" ]] || fail "$short: البناء خلص بس ملف الـAAB مش موجود في $aab"

  # ── التحقق من الناتج نفسه (مش من الأمر اللي اتكتب) ──
  verify_artifact "$short" "$aab" 'base/lib/arm64-v8a/libapp.so'

  # التوقيع: بنتأكد إن الملف موقّع أصلاً. بصمة الشهادة **عامة** (Play بيعرضها في Console)،
  # فعرضها آمن وبيخلّيك تقارنها ببصمة «مفتاح الرفع» في Play Console قبل ما ترفع.
  local signer=""
  if command -v keytool >/dev/null; then
    signer="$(keytool -printcert -jarfile "$aab" 2>/dev/null | grep -m1 'SHA256:' | awk '{print $2}' || true)"
  fi
  [[ -n "$signer" ]] || red "⚠️  $short: مقدرتش أقرا بصمة التوقيع (keytool مش موجود؟) — اتأكد يدويًا"

  local dest="$OUT_ROOT/osta-${short}-${name}-build${code}.aab"
  cp "$aab" "$dest"

  local apk_dest=""
  if [[ "$WITH_APK" == "true" ]]; then
    # APK للتجربة على الموبايل مباشرةً — الـAAB مابيتسطّبش على جهاز. نفس العنوان ونفس الفحص.
    ( cd "$dir" && flutter build apk --release --dart-define=API_BASE_URL="$API_BASE_URL" )
    local apk="$dir/build/app/outputs/flutter-apk/app-release.apk"
    [[ -f "$apk" ]] || fail "$short: بناء الـAPK خلص بس الملف مش موجود في $apk"
    verify_artifact "$short" "$apk" 'lib/arm64-v8a/libapp.so'
    apk_dest="$OUT_ROOT/osta-${short}-${name}-build${code}.apk"
    cp "$apk" "$apk_dest"
  fi

  green "✅ $short جاهز — العنوان متخبّز صح، وعنوان التطوير مش موجود"
  RESULTS+=("$short|$name|$code|$dest|$signer|$apk_dest")
}

for app in "${APPS[@]}"; do build_one "$app"; done

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
green "كل النسخ اتبنت واتفحصت. ارفع دول بالظبط:"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r short name code dest signer apk_dest <<<"$row"
  echo
  echo "  ${short}: ${name} (versionCode ${code})"
  echo "    للرفع على Play:  ${dest}"
  [[ -n "$apk_dest" ]] && echo "    للتجربة على الموبايل:  ${apk_dest}"
  [[ -n "$signer" ]] && echo "    بصمة التوقيع SHA-256: ${signer}"
done
if [[ "$WITH_APK" == "true" ]]; then
  echo
  echo "تجربة الـAPK: جرّب التثبيت كتحديث أولاً؛ لو ظهر اختلاف توقيع عن نسخة Play، استخدم جهاز تجربة"
  echo "أو مسار Internal testing. لا تمسح النسخة الحالية تلقائياً لأن الحذف يمسح بياناتها المحلية."
fi
echo
echo "قبل الرفع: البصمة لازم تطابق «مفتاح الرفع» في Play Console ← App integrity ← App signing."
echo "العنوان المتخبّز: ${API_BASE_URL}"
