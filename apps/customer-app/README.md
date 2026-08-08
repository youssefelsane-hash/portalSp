# apps/customer-app — تطبيق العميل

تسجيل بـ OTP، GPS، طلب خدمة، تتبع الفني لحظياً، دفع، تقييم، شات. الستاك: **Flutter** (iOS + Android من كود واحد).

## الحالة الحالية — بداية حقيقية، مش كل الميزات لسه

اللي موجود:
- تسجيل دخول OTP كامل (طلب كود → تحقق → جلسة) ضد `apps/api` الحقيقي، مطابق تماماً لنفس معمارية الأمان المُستخدمة في `apps/admin` (راجع `apps/admin/README.md` للتفاصيل الكاملة):
  - `access_token`: في الذاكرة بس (state جوّه `AuthRepository`)، مش أي تخزين دائم.
  - `refresh_token`: في `flutter_secure_storage` (Keychain على iOS، Keystore على Android) — مش `SharedPreferences`.
  - **نفس بَقّة الـ single-flight refresh اللي اتلقطت في `apps/admin` اتصلحت هنا من الأول** — `lib/core/auth_repository.dart` فيه نفس حل الـ `_inFlightRefresh`.
- تصفح الكتالوج (`lib/features/catalog/`): فئات الخدمات (شاشة رئيسية بعد تسجيل الدخول) → خدمات كل فئة، ضد `/service-categories` و`/services` الحقيقيين (مسارات عامة، Public()).

**لسه من غير**: GPS، طلب خدمة فعلي، تتبع الفني لحظياً، دفع، تقييم، شات.

## اختبار حي حقيقي — اكتشاف مهم غيّر إستراتيجية الاختبار هنا

كنا موثّقين إن مفيش طريقة نتحقق بيها حياً من كود Flutter في البيئة دي (مفيش Android/iOS emulator، ومحاولة بديل Linux desktop فشلت — تفاصيل تحت). ده لسه صحيح **بس للـ widgets نفسها**. اكتشفنا إن قيد "أي HTTP request في اختبار Flutter بيرجع 400" مرتبط تحديداً بـ `TestWidgetsFlutterBinding` (اللي `testWidgets()` بيستخدمه) — مش بكل اختبارات Flutter. اختبار `test()` العادي (Dart VM خام، من غير widget tree) **معندوش القيد ده خالص**.

النتيجة: `test_live/` (مجلد منفصل عن `test/` عمداً — `flutter test` من غير مسار بيدوّر على كل الملفات جوّه `test/` بس، فمعزول عن التشغيل الافتراضي) فيه اختبارات بتكلم `apps/api` الحقيقي فعلياً:
- `test_live/otp_flow_live_test.dart` — تدفق OTP كامل (طلب → تحقق → `access_token`/`refresh_token` حقيقيين → `/auth/me` بيرجّع نفس رقم الموبايل). بيتحقق بشكل حاسم من الجزء الأمني الأهم (تدوير التوكنات) اللي فيه بَقّة apps/admin اتلقطت.
- `test_live/catalog_repository_live_test.dart` — `CatalogRepository` بيجيب فئات وخدمات حقيقية من القاعدة.

تشغيلهم: `flutter test test_live/ --dart-define=API_BASE_URL=http://localhost:3000/api/v1` (محتاج `apps/api` شغال فعلاً).

**الفجوة المتبقية بصراحة**: الجزء اللي لسه مش قابل للاختبار في البيئة دي هو تحديداً اللي محتاج `TestWidgetsFlutterBinding` (رندر الـ UI الفعلي، تفاعل المستخدم زي الضغط/الكتابة) — لأن ده بالذات بيفعّل قيد الـ HTTP. يعني: منطق الشبكة والـ auth مُتحقق منه حياً وبثقة عالية، لكن "هل الشاشة بتتعرض صح فعلياً وبتستجيب للمس؟" لسه معتمد على `flutter analyze` + `flutter test` (widget tests بـ mocks) + مراجعة كود بس، مش رؤية بصرية حقيقية أو تفاعل حقيقي.

### محاولة Linux desktop (فشلت — تفاصيل للسجل)

بعد تثبيت `libgtk-3-dev` و`libsecret-1-dev` يدوياً (مكانوش موجودين)، الـ compile نجح (`flutter build linux` رجّع "Built")، لكن خطوة "تجميع الـ bundle" في نسخة Flutter/CMake/Ninja دي بتفشل بصمت: الملف التنفيذي بيتحط في `build/linux/.../intermediates_do_not_run/` من غير ملفات الـ AOT/ELF data المفروض تتحط جنبه — تشغيله مباشرة بيدي `FlutterEngineCreateAOTData: Invalid ELF path specified`. تعارض في أدوات البناء نفسها، مش بَقّة في كود التطبيق.

## التشغيل محلياً (على جهاز فيه Android/iOS toolchain حقيقي)

```bash
cd apps/customer-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://<عنوان الباك-إند>/api/v1
# Android emulator بيوصل للـ host عن طريق 10.0.2.2 (القيمة الافتراضية) مش localhost
```

مرجع كامل: `../../docs/01-master-plan.md`
