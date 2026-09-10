#!/usr/bin/env bash
# فحص تكافؤ الطبقة الأصلية بين Android وiOS للتطبيقين.
#
# **ليه سكريبت مش مراجعة بالعين**: كود Dart واحد للمنصتين، فالفرق الوحيد الممكن هو الإعدادات
# الأصلية — وهي بالظبط النوع اللي بيتنسى بصمت لأن محدش بيفتح المنصة التانية. الفحص ده بيقارن
# البنود اللي ليها نظير مباشر ويطلع بكود خروج غير صفري لو واحدة ناقصة.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
ok()   { printf '✅ %s\n' "$1"; }
bad()  { printf '❌ %s\n' "$1"; fail=1; }

check() { # <وصف> <ملف> <نمط>
  if grep -q "$3" "$2" 2>/dev/null; then ok "$1"; else bad "$1 — مالقيتش «$3» في $2"; fi
}

for app in customer-app technician-app; do
  echo "── $app ──"
  M="apps/$app/android/app/src/main/AndroidManifest.xml"
  P="apps/$app/ios/Runner/Info.plist"
  E="apps/$app/ios/Runner/Runner.entitlements"
  S="apps/$app/ios/Runner/Base.lproj/LaunchScreen.storyboard"

  check "موقع: أندرويد"      "$M" "ACCESS_FINE_LOCATION"
  check "موقع: iOS"          "$P" "NSLocationWhenInUseUsageDescription"
  check "بصمة: أندرويد"      "$M" "USE_BIOMETRIC"
  check "بصمة: iOS"          "$P" "NSFaceIDUsageDescription"
  check "إشعارات: أندرويد"   "$M" "POST_NOTIFICATIONS"
  check "إشعارات: iOS"       "$P" "remote-notification"
  check "APNs entitlement"   "$E" "aps-environment"
  check "لغة iOS عربية"      "$P" "<string>ar</string>"
  check "خلفية إقلاع أندرويد" "apps/$app/android/app/src/main/res/values/colors.xml" "splash_background"
  check "خلفية إقلاع أندرويد (داكن)" "apps/$app/android/app/src/main/res/values-night/colors.xml" "splash_background"
  check "خلفية إقلاع iOS"     "$S" "LaunchBackground"
  [ -f "apps/$app/ios/Runner/Assets.xcassets/LaunchBackground.colorset/Contents.json" ] \
    && ok "لون إقلاع iOS بنسختين" || bad "ناقص LaunchBackground.colorset"

  # الكاميرا مطلوبة بس لو التطبيق فعلاً بيرفع صور
  if grep -q "image_picker" "apps/$app/pubspec.yaml"; then
    check "كاميرا: أندرويد أو iOS" "$P" "NSCameraUsageDescription"
  fi
  # الخرائط: لازم تكون في المنصتين أو في ولا واحدة
  if grep -q "google_maps_flutter" "apps/$app/pubspec.yaml"; then
    check "مفتاح خرائط iOS" "$P" "GoogleMapsApiKey"
    check "مفتاح خرائط أندرويد" "$M" "com.google.android.geo.API_KEY"
  else
    ok "مفيش خرائط في التطبيق ده — مفيش مفتاح مطلوب في الاتنين"
  fi
done

echo
[ "$fail" -eq 0 ] && echo "🎉 كل بنود التكافؤ الأصلية موجودة في المنصتين" || echo "⚠️ فيه بنود ناقصة فوق"
exit "$fail"
