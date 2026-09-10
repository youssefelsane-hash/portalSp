# تكافؤ Android ↔ iOS ↔ Web — مرجع واحد

**طلب المالك (2026-09-10)**: «أنا ما فتحتش حاجة غير الأندرويد… عايزك تتأكد من الويب وكمان من
الـiOS. الـiOS أنا ما فتحتوش خالص لحد دلوقتي، فأنا عايزك تتأكدلي إن كل حاجة موجودة في الأندرويد
موجودة في الـiOS، الديزاين، كل حاجة… وكل الفيوتشرز وكل الزرار… يكونوا التلاتة زي بعض».

## القاعدة الحاكمة: منين بييجي التكافؤ أصلاً

**Android وiOS بيشتغلوا من نفس كود Dart بالحرف** (`apps/customer-app/lib` و
`apps/technician-app/lib`). مفيش أي `Platform.isAndroid` بيغيّر شاشة أو زرار — الفرق الوحيد
الممكن هو **إعدادات المنصة الأصلية**: الأذونات، شاشة الإقلاع، الإشعارات، الخرائط، اللغة.
يعني «الديزاين وكل الزرار» متطابقين بحكم البنية، والمراجعة الحقيقية لازم تتركّز على الطبقة
الأصلية دي — وده اللي الجدول تحت بيغطيه بندًا بندًا.

الويب (`apps/customer-web`) كود منفصل (Next.js)، فتكافؤه بيتراجع بالميزة مش بالكود.

## جدول الطبقة الأصلية (Android ↔ iOS)

| البند | Android | iOS | الحالة |
|---|---|---|---|
| موقع (fine/coarse) | `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` | `NSLocationWhenInUseUsageDescription` | ✅ متكافئ |
| كاميرا | `CAMERA` | `NSCameraUsageDescription` | ✅ |
| معرض الصور | (Scoped Storage — بلا إذن) | `NSPhotoLibraryUsageDescription` | ✅ |
| بصمة/وجه | `USE_BIOMETRIC` | `NSFaceIDUsageDescription` | ✅ |
| إشعارات | `POST_NOTIFICATIONS` | `UIBackgroundModes: remote-notification` + `aps-environment` | ✅ |
| خرائط (العميل فقط) | `com.google.android.geo.API_KEY` من `local.properties` | `GoogleMapsApiKey` في `Info.plist` من xcconfig، بيتقرا في `AppDelegate.swift` | ✅ |
| خرائط (الفني) | — | — | ✅ التطبيق مافيهوش `google_maps_flutter` أصلاً |
| **خلفية شاشة الإقلاع** | `@color/splash_background` + نسخة `values-night` | `LaunchBackground.colorset` بنسختين (فاتح/داكن) | ✅ **اتصلح 2026-09-10** — الاتنين كانوا أبيض ثابت |
| **لغة النظام** | نصوص التطبيق عربية من الـAPK | `CFBundleDevelopmentRegion=ar` + `CFBundleLocalizations=[ar,en]` | ✅ **اتصلح 2026-09-10** — من غيره حوارات أذونات iOS بتظهر إنجليزي جنب واجهة عربية |
| روابط عميقة (URL) | مفيش intent-filter | مفيش `CFBundleURLTypes` | ⚖️ متكافئ (الاتنين لأ). التوجيه الحالي من حمولة الإشعار، ومسح QR بيروح للويب |

### إزاي تتأكد بنفسك بعد أي تعديل

```
bash scripts/mobile-parity-check.sh
```

## تكافؤ الميزات مع الويب

الويب عمدًا **مش نسخة بصرية** من الموبايل (طلب المالك: «ديزاين الويب نفس الأفكار، بس الديزاين
نفسه احترافي وpremium»)، لكن **كل ميزة وكل زرار** لازم يبقى موجود. المرجع الحي للفحص ده
`apps/customer-web/README.md` (مصفوفة التكافؤ) واختبارات Playwright جنبها.
