# apps/customer-app — تطبيق العميل

تسجيل بـ OTP، GPS، طلب خدمة، تتبع الفني لحظياً، دفع، تقييم، شات. الستاك: **Flutter** (iOS + Android من كود واحد).

## الحالة الحالية — بداية حقيقية، مش كل الميزات لسه

اللي موجود:
- تسجيل دخول OTP كامل (طلب كود → تحقق → جلسة) ضد `apps/api` الحقيقي، مطابق تماماً لنفس معمارية الأمان المُستخدمة في `apps/admin` (راجع `apps/admin/README.md` للتفاصيل الكاملة):
  - `access_token`: في الذاكرة بس (state جوّه `AuthRepository`)، مش أي تخزين دائم.
  - `refresh_token`: في `flutter_secure_storage` (Keychain على iOS، Keystore على Android) — مش `SharedPreferences`.
  - **نفس بَقّة الـ single-flight refresh اللي اتلقطت في `apps/admin` اتصلحت هنا من الأول** — `lib/core/auth_repository.dart` فيه نفس حل الـ `_inFlightRefresh`.
- تصفح الكتالوج (`lib/features/catalog/`): فئات الخدمات (شاشة رئيسية بعد تسجيل الدخول) → خدمات كل فئة، ضد `/service-categories` و`/services` الحقيقيين (مسارات عامة، Public()).
- **العناوين (`lib/features/geo/`, `lib/features/addresses/`)**: `GeoRepository` بيجيب مدن/مناطق حقيقية (`/cities`, `/cities/:id/areas`، عامة). `AddressesRepository` + `AddressesScreen`/`AddressFormScreen` — إضافة/عرض/مسح عناوين حقيقية ضد `/addresses` (`GET`/`POST`/`DELETE`). **قرار مبسّط متعمد**: خط العرض/الطول بيتكتبوا يدوياً (حقلين رقم)، مفيش `geolocator` أو أي pluging GPS حقيقي — البيئة دي مالهاش جهاز/emulator حقيقي لاختبار صلاحيات الموقع أصلاً، فإضافة اعتماد native plugin مش قابل للاختبار حياً كانت هتبقى وهم أمان مش ميزة حقيقية. لما يتوفر جهاز حقيقي، الاستبدال بسيط (حقل الإدخال بس هيتغير لزرار "موقعي الحالي").
- **الطلبات (`lib/features/orders/`)**: `OrdersRepository` + `CreateOrderScreen` (اختيار خدمة من الكتالوج → اختيار/إضافة عنوان → وصف مشكلة اختياري → `POST /orders`) + `OrdersScreen` (قائمة طلبات العميل) + `OrderDetailScreen` (تفاصيل + إلغاء لو الحالة لسه قابلة للإلغاء، نفس `customerCancellableStatuses` في `order-state-machine.ts`).
- **إلغاء بسبب مُختار + رسوم — كانت فجوة موثّقة (الإلغاء كان بياخد نص حر بس)، اتقفلت**: زرار "إلغاء الطلب" بقى بيفتح `AlertDialog` بيجيب قايمة أسباب حقيقية من `GET /cancellation-reasons?applies_to=customer` (`@Public()`، مفيش حتى احتياج توكن) — `RadioListTile` لكل سبب، بيوضّح جنبه لو ممكن يترتب عليه رسوم (`fee_percentage`)، بالإضافة لحقل نص حر اختياري. لو فشل تحميل القايمة (شبكة مثلاً)، الـ dialog لسه بيفتح بحقل النص الحر بس — فشل تحميل الأسباب مش لازم يمنع الإلغاء نفسه. بعد الإلغاء، لو `cancellation_fee_cents > 0` في الرد، بيظهر `SnackBar` بالمبلغ بالظبط.
- **اتعمله اختبار حي حقيقي كامل** (`test_live/cancellation_reasons_live_test.dart`): قايمتين حقيقيتين (`applies_to=customer`/`applies_to=technician`) اتفلتروا صح، نافذة الإلغاء المجاني اتصغّرت لصفر مؤقتاً عبر الـ API، طلب حقيقي اتلغى بسبب فيه رسوم → **الرسوم اتحسبت بالظبط (نسبة × إجمالي السعر) واتخصمت فعلياً من رصيد محفظة العميل الحقيقي** (اتأكد برصيد قبل/بعد مباشر)، ومحاولة استخدام سبب `applies_to=technician` لإلغاء عميل اترفضت زي المتوقع. النافذة رجعت لقيمتها الأصلية في `finally` حتى لو الاختبار فشل.
- **اتعمله اختبار حي حقيقي كامل** (`test_live/order_creation_live_test.dart`): عميل حقيقي سجّل دخول، جاب مدن/مناطق حقيقية، ضاف عنوان حقيقي (`POST /addresses` نجح واترجعت بياناته بالظبط)، لقى أول خدمة فعلية عندها كتالوج مربوط (بعض الفئات في القاعدة التطويرية فاضية من اختبارات تانية، فالاختبار بيدوّر مش بيفترض أول فئة)، أنشأ طلب حقيقي (`order_status` رجع `searching_technician` صح)، جابه بـ`GET /orders/:id` وبـ`GET /orders`، ألغاه (`cancelled_by_customer`)، ومسح العنوان التجريبي.
- **التقييم (`lib/features/ratings/`)**: `RatingsRepository.rate()` + `showRatingDialog()` (1-5 نجوم + تعليق اختياري) — زرار "قيّم الطلب" بيظهر في `OrderDetailScreen` لما `order_status == completed`. **ملحوظة صراحة**: مفيش endpoint تحقق مسبق ("هل الطلب ده اتقيّم قبل؟") في الباك-إند، فالتطبيق بيحاول ويتعامل مع رفض `409` ("الطلب ده اتقيّم قبل كده") كنتيجة "متقيّم بالفعل" مش خطأ حقيقي — تجربة استخدام كويسة بس معتمدة على state محلي (لو العميل قفل الشاشة ورجعلها، الزرار هيظهر تاني لحد ما يحاول يقيّم فعلياً ويترفض). **اتعمله اختبار حي حقيقي** (`test_live/rating_live_test.dart`): عميل حقيقي دوّر على أول طلب `completed` بتاعه لسه مش مُقيَّم من قايمة `GET /orders` الحقيقية، قيّمه 5/5 بتعليق ونجح، وحاول يقيّمه تاني فاترفض `409` بالظبط زي ما متوقع.

- **الدفع من المحفظة (`lib/features/payments/`)**: `PaymentsRepository.payWithWallet()` — زرار "ادفع من المحفظة" في `OrderDetailScreen` لما `order_status` يكون `work_completed`/`awaiting_payment` و`payment_status` لسه مش `paid`. `Idempotency-Key` إجباري في الباك-إند لكل عملية دفع — بيتولّد محلياً (timestamp + رقم عشوائي، مش UUID package كامل لسطر واحد). ده استلزم إضافة دعم `extraHeaders` عبر `api_client.dart`/`auth_repository.dart` (مكانش موجود قبل كده — بس `Content-Type`/`Authorization`).
- **بَقّة مالية حقيقية اتلقطت واتصلحت وقت بناء الميزة دي** (تفاصيل كاملة في `../api/src/modules/payments/README.md`): اختبار الدفع الحي كشف إن الباك-إند كان بيحوّل عمولة الفني لمحفظة **فني عشوائي غير مرتبط بالطلب** لو الطلب وصل للتسوية بـ`technician_id` فاضي (`TypeORM` بيسقط شرط `null` بدل ما يرجّع نتيجة فاضية). السيناريو مش قابل للوصول عبر مسارات التطبيق الحقيقية (الفني دايماً بيتعيّن قبل أي حالة قابلة للدفع)، بس اتكشفت لأن الاختبار الحي احتاج طلب تجريبي جاهز بحالة `work_completed` من غير ما يعدّي دورة الفني الكاملة. اتصلحت في الباك-إند (`payments.service.ts`, `technicians.service.ts`, `customer-profiles.service.ts`)، واتأكد الإصلاح حياً قبل ما ميزة الدفع دي تتوثّق كمكتملة.
- **اتعمله اختبار حي حقيقي** (`test_live/wallet_payment_live_test.dart`): عميل حقيقي برصيد محفظة كافي دفع طلب `work_completed` حقيقي من رصيده، اتأكد `payment_method=wallet`/`payment_status=succeeded`/المبلغ مطابق تماماً لسعر الطلب، الطلب بقى `completed`/`paid` فعلاً، والرصيد اتخصم بالظبط بقيمة الطلب. **ملحوظة صراحة**: محتاج رصيد محفظة وطلب `work_completed` مُجهّزين مسبقاً بـ`psql` مباشر (مفيش مسار API لشحن محفظة عميل تجريبي أو لإنشاء طلب في الحالة دي مباشرة من غير دورة فني كاملة) — موثّق في تعليقات الاختبار نفسه.

- **التتبع اللحظي (`lib/features/tracking/`)**: `OrderTrackingClient` (Socket.IO عبر `socket_io_client`، namespace `/tracking` مطابق تماماً لـ`order-tracking.gateway.ts`) + `TrackingScreen` — زرار "تتبّع الفني لحظياً" في `OrderDetailScreen` بيظهر لما الطلب في حالة نشطة (`accepted`/`technician_on_way`/`technician_arrived`/`in_progress`، مطابق `ACTIVE_TRACKING_STATUSES`). بيتصل، ينضم لـ`tracking:join`، وبيعرض آخر إحداثيات مستلمة من `order:location_updated` كنص (خط عرض/طول + وقت) — **مفيش خريطة فعلية**، قرار نطاق متعمد زي قرار الـ GPS اليدوي (مفيش package خرائط ولا API key، ومفيش جهاز حقيقي أصلاً لعرضها بصرياً). **باگ حقيقي اتلقط واتصلح وقت الاختبار الحي**: `socket_io_client` بيشارك/يعيد استخدام نفس الـ `Manager` لنفس الـ URI افتراضياً — لما الاختبار احتاج اتصالين متوازيين (عميل+فني) في نفس الـ process، التاني كان بيقفل الأول بصمت (`io client disconnect`). الحل: `.enableForceNew()` على كل اتصال — اتطبّق في الكود الحقيقي (`tracking_client.dart`) مش بس الاختبار، لأن نفس الفخ ممكن يحصل لو المستخدم فتح `TrackingScreen` مرتين بسرعة. **اتعمله اختبار حي حقيقي كامل** (`test_live/order_tracking_live_test.dart`): طلب حقيقي، فني حقيقي قبله، عميل اتصل وانضم فعلاً (`tracking:joined`)، الفني بعت موقع حقيقي عبر `technician:location`، والعميل استلمه فعلاً عبر `order:location_updated` بنفس الإحداثيات بالظبط.

- **الشات مع الفني (`lib/features/chat/`)**: `ChatClient` (Socket.IO namespace `/chat`، مطابق `ChatGateway`) + `ChatScreen` — زرار "الشات مع الفني" بيظهر في `OrderDetailScreen` لما `technician_id` يبقى موجود (يعني الفني قبل). الشاشة بتجيب `thread_id` أولاً عبر endpoint جديد اتضاف في الباك-إند خصيصاً لده (`GET /chat/orders/:orderId/thread` — كانت فجوة حقيقية: الخيط بيتعمل تلقائياً وقت القبول بس مفيش كان طريقة للكلاينت يكتشف الـ `thread_id`، تفاصيل كاملة في `../api/src/modules/chat/README.md`)، بعدين تاريخ الرسائل عبر REST، وبعدين تتصل لحظياً. **اتعمله اختبار حي حقيقي كامل** (`test_live/chat_live_test.dart`): طلب حقيقي قبل القبول رجّع `404` صريح على endpoint الخيط الجديد، بعد ما فني حقيقي قبله رجّع الخيط الصح، عميل وفني حقيقيين اتصلوا بـ WebSocket وتبادلوا رسالتين حقيقيتين لحظياً (كل طرف استقبل رسالة التاني فوراً عبر `chat:message_received`)، وتاريخ الرسائل عبر REST طابق الترتيب والمحتوى بالظبط.

- **كود خصم وقت الحجز**: `CreateOrderScreen` بقى فيه حقل كود + زرار "تحقق" بينادي `GET /promo-codes/:code/validate` ويعرض قيمة الخصم قبل التأكيد، والكود بيتبعت فعلياً مع `POST /orders` (`promo_code`). **اتعمله اختبار حي حقيقي** (`test_live/promo_code_order_live_test.dart`): كود خصم تجريبي حقيقي اتعمل عبر مسار الأدمن، عميل حقيقي تحقق منه (رجّع خصم 5000 قرش بالظبط)، أنشأ طلب بيه (`discount_amount_cents`/`promo_code_id`/`total_amount_cents` كلهم طابقوا الحساب الصح)، محاولة تانية بنفس الكود اترفضت (حد استخدام لكل مستخدم)، والكود التجريبي اتعطّل بعد الاختبار.

**لسه من غير**: خريطة فعلية للتتبع (نص بس دلوقتي، تفاصيل فوق)، دفع من غير محفظة (بطاقة/فوري).

## اختبار حي حقيقي — اكتشاف مهم غيّر إستراتيجية الاختبار هنا

كنا موثّقين إن مفيش طريقة نتحقق بيها حياً من كود Flutter في البيئة دي (مفيش Android/iOS emulator، ومحاولة بديل Linux desktop فشلت — تفاصيل تحت). ده لسه صحيح **بس للـ widgets نفسها**. اكتشفنا إن قيد "أي HTTP request في اختبار Flutter بيرجع 400" مرتبط تحديداً بـ `TestWidgetsFlutterBinding` (اللي `testWidgets()` بيستخدمه) — مش بكل اختبارات Flutter. اختبار `test()` العادي (Dart VM خام، من غير widget tree) **معندوش القيد ده خالص**.

النتيجة: `test_live/` (مجلد منفصل عن `test/` عمداً — `flutter test` من غير مسار بيدوّر على كل الملفات جوّه `test/` بس، فمعزول عن التشغيل الافتراضي) فيه اختبارات بتكلم `apps/api` الحقيقي فعلياً:
- `test_live/otp_flow_live_test.dart` — تدفق OTP كامل (طلب → تحقق → `access_token`/`refresh_token` حقيقيين → `/auth/me` بيرجّع نفس رقم الموبايل). بيتحقق بشكل حاسم من الجزء الأمني الأهم (تدوير التوكنات) اللي فيه بَقّة apps/admin اتلقطت.
- `test_live/catalog_repository_live_test.dart` — `CatalogRepository` بيجيب فئات وخدمات حقيقية من القاعدة.
- `test_live/order_creation_live_test.dart` — دورة عنوان+طلب كاملة (تفاصيل فوق).
- `test_live/rating_live_test.dart` — تقييم طلب مكتمل + رفض المحاولة التانية (تفاصيل فوق).
- `test_live/wallet_payment_live_test.dart` — دفع طلب من المحفظة (تفاصيل فوق).
- `test_live/order_tracking_live_test.dart` — تتبع لحظي حقيقي عبر Socket.IO بين عميل وفني (تفاصيل فوق).
- `test_live/chat_live_test.dart` — شات لحظي حقيقي بين عميل وفني (تفاصيل فوق).
- `test_live/promo_code_order_live_test.dart` — تحقق وتطبيق كود خصم حقيقي وقت إنشاء طلب (تفاصيل فوق).
- `test_live/cancellation_reasons_live_test.dart` — أسباب إلغاء + رسوم حقيقية اتخصمت من المحفظة (تفاصيل فوق).

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
