# apps/customer-app — تطبيق العميل

تسجيل بـ OTP، GPS، طلب خدمة، تتبع الفني لحظياً، دفع، تقييم، شات. الستاك: **Flutter** (iOS + Android من كود واحد).

## الحالة الحالية — بداية حقيقية، مش كل الميزات لسه

اللي موجود: تسجيل دخول OTP كامل (طلب كود → تحقق → جلسة) ضد `apps/api` الحقيقي، مطابق تماماً لنفس معمارية الأمان المُستخدمة في `apps/admin` (راجع `apps/admin/README.md` للتفاصيل الكاملة):

- `access_token`: في الذاكرة بس (state جوّه `AuthRepository`)، مش أي تخزين دائم.
- `refresh_token`: في `flutter_secure_storage` (Keychain على iOS، Keystore على Android) — مش `SharedPreferences`.
- **نفس بَقّة الـ single-flight refresh اللي اتلقطت في `apps/admin` اتصلحت هنا من الأول** — الباك-إند بيدوّر `refresh_token` على كل استخدام وبيقفل كل جلسات المستخدم لو توكن اتلغى استُخدم تاني، فأي نداءين `refresh` متزامنين (زي `init()` بيتنادى مرتين لأي سبب) لازم يشاركوا نفس الـ request بدل ما يتسابقوا. `lib/core/auth_repository.dart` فيه نفس الحل (`_inFlightRefresh`).

**لسه من غير**: كل الميزات الفعلية (GPS، طلب خدمة، تتبع الفني، دفع، تقييم، شات) — دي المرحلة الجاية.

## فجوة اختبار موثّقة صراحة — مفيش E2E تفاعلي حقيقي في البيئة دي

خلافاً لـ `apps/admin` (اتعمله اختبار حي كامل عبر Playwright في متصفح حقيقي)، تطبيق Flutter ده **متتحققش بصرياً/تفاعلياً بشكل كامل** في بيئة البناء دي، لسببين حقيقيين لا علاقة لهم بصحة الكود:

1. **مفيش Android/iOS emulator أو device متاح** في البيئة (`flutter doctor` بيأكد كده — مفيش Android SDK ولا Xcode).
2. **بُني كتطبيق Linux desktop كبديل للاختبار البصري** (بعد تثبيت `libgtk-3-dev` و`libsecret-1-dev` يدوياً — مكانوش موجودين) — الـ compile نجح فعلاً (`flutter build linux` رجّع "Built"), لكن اكتشفنا إن خطوة "تجميع الـ bundle" في نسخة Flutter/CMake/Ninja دي بتفشل بصمت: الملف التنفيذي بيتحط في `build/linux/.../intermediates_do_not_run/` بس **من غير** ملفات الـ AOT/ELF data المفروض تتحط جنبه في `bundle/` — تشغيله مباشرة بيدي خطأ `FlutterEngineCreateAOTData: Invalid ELF path specified`. ده تعارض في أدوات البناء نفسها، مش بَقّة في كود التطبيق (الـ `flutter analyze` نضيف تماماً، `flutter build linux` بيرجع "Built" بنجاح ظاهري).

**اللي اتعمل فعلياً بدل كده**: `flutter analyze` (تحليل ثابت، صفر مشاكل) + `flutter test` (اختبار widget حقيقي بيتأكد إن شاشة تسجيل الدخول بتظهر صح لما مفيش جلسة محفوظة، مع mock لـ `flutter_secure_storage`'s platform channel لأنه مش موجود في بيئة الاختبار) + مراجعة كود دقيقة إن منطق الـ HTTP/auth طبق الأصل من نفس النمط المُثبَت شغال 100% في `apps/admin` ضد نفس الباك-إند. **الاختبار البصري/التفاعلي الحقيقي على جهاز فعلي أو محاكي لسه فجوة موثّقة صراحة** — أول حاجة لازم تتعمل قبل أي اعتماد على التطبيق ده في الإنتاج.

## التشغيل محلياً (على جهاز فيه Android/iOS toolchain حقيقي)

```bash
cd apps/customer-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://<عنوان الباك-إند>/api/v1
# Android emulator بيوصل للـ host عن طريق 10.0.2.2 (القيمة الافتراضية) مش localhost
```

مرجع كامل: `../../docs/01-master-plan.md`
