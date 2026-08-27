# 03 — دليل ربط الخدمات الخارجية

الكود بتاع كل تكامل خارجي في baytak **جاهز 100% ومختبر حي** بالقدر اللي البيئة دي سمحت بيه (مفيش
إنترنت خارجي متاح وقت البناء). كل حاجة محتاجة اعتماد حقيقي (API key/secret/حساب) بترجع رفض واضح
(مش انهيار، مش نجاح وهمي) لحد ما تحطّ القيم الحقيقية. الملف ده بيقولّك بالظبط: كل قيمة محتاجاها
منين، وتحطها فين، وإزاي تتأكد إنها اشتغلت.

**القاعدة العامة**: أي env var في `apps/api/.env` (نسخة من `apps/api/.env.example`) فاضية أو ناقصة
= الميزة المرتبطة بيها بترجع لسلوك آمن افتراضي (log-only للإشعارات، تخزين محلي، رفض واضح للدفع
بالبطاقة) — النظام كله بيفضل شغال من غيرها، بس الميزة دي بس مش متفعّلة.

**بَقّة حقيقية اتلقطت واتصلحت (2026-08-11، أول تشغيل حي للسيرفر في سيشن صُنّاع)**: `cp .env.example
.env` بالظبط زي ما الملف بيقول — كل قيم التكامل الاختيارية (Paymob/FawryPay/S3/FCM/Twilio/SMTP)
كانت `KEY=` (سلسلة فاضية، مش غير موجودة خالص). `env.validation.ts`'s Joi schema كانت
`Joi.string().optional()` بس من غير `.allow('')` — القيمة الفاضية دي كانت بترمي `Config validation
error` وتمنع السيرفر يشتغل خالص، عكس الموثّق فوق تمامًا ("النظام كله بيفضل شغال من غيرها"). اتصلحت
بإضافة `.allow('')` لكل القيم الاختيارية دي في `apps/api/src/config/env.validation.ts` — الكود
اللي بيقرا `process.env.X` مباشرة (`configuration.ts`) مكانش هيتأثر أصلاً (فاضي = falsy زي زمان)،
الإصلاح في طبقة التحقق بس. اتأكد حياً: `cp .env.example .env` + `npm run start:dev` بقى بيشتغل
لغاية `NestApplication successfully started` من غير أي تعديل يدوي على القيم.

---

## 1. بوابة الدفع بالبطاقة — Paymob

**ليه Paymob بالذات**: أشهر بوابة دفع مصرية، مطابقة لعملة EGP اللي كل أسعار baytak بيها بالفعل،
وموثّقة في `docs/01-master-plan.md` من الأول كخيار أساسي.

**الكود**: `apps/api/src/modules/payments/gateways/paymob-provider.service.ts` (تكامل حقيقي مع
Intention API وUnified Checkout) — تفاصيل معمارية كاملة في
`docs/adr/0013-payment-provider-abstraction.md`.

### الخطوات

1. اعمل حساب على [accept.paymob.com](https://accept.paymob.com) (Egypt أو المنطقة المناسبة لك).
2. من لوحة التحكم هات **API Key**، **Secret Key**، **Public Key**، و**HMAC
   Secret**. الأول مطلوب لاستعلامات العمليات، الثاني لـIntention API، الثالث
   لرابط Unified Checkout، والرابع للتحقق من webhook.
3. من **Developers → Payment Integrations** اعمل integration لنوع **Online Card**
   واحفظ **Integration ID**. لا تحتاج Iframe ID؛ التنفيذ الحالي لا يستخدم
   التدفق القديم.
4. اختياريًا، اعمل integration منفصلة لـ**Mobile Wallet** واحفظ Integration ID
   الخاص بها.
5. من **Developers → Webhooks** ضيف الـcallback URL:
   `https://YOUR_DOMAIN/api/v1/webhooks/paymob` (استبدل `YOUR_DOMAIN` بدومين السيرفر الحقيقي وقت
   النشر).

### مكان القيم — لوحة الإدارة (المفضل)

من **الإعدادات → payments_paymob** أدخل:

| مفتاح الإعداد | القيمة |
|---|---|
| `payments.paymob.base_url` | `https://accept.paymob.com` |
| `payments.paymob.api_key` | API Key |
| `payments.paymob.secret_key` | Secret Key |
| `payments.paymob.public_key` | Public Key |
| `payments.paymob.integration_id_card` | Online Card Integration ID |
| `payments.paymob.integration_id_mobile_wallet` | Mobile Wallet Integration ID (اختياري) |
| `payments.paymob.hmac_secret` | HMAC Secret |

`api_key` و`secret_key` و`hmac_secret` تُخزّن بتشفير AES-256-GCM، ولا يعيدها
الـAPI أو يعرضها في سجل التدقيق. يجب ضبط `SETTINGS_ENCRYPTION_KEY` بقيمة عشوائية
ثابتة 32 حرفًا على الأقل في بيئة الـAPI؛ هذا المفتاح الرئيسي لا يوضع في لوحة
الإدارة. الحفظ يُعيد تحميل مزود Paymob فورًا في النسخة التي استلمت التعديل؛
في نشر متعدد النسخ أعد تشغيل باقي النسخ بعد التعديل.

### خطة الاحتياط بـenv

يقرأ المزود القيم التالية كـfallback إذا كان إعداد لوحة الإدارة فارغًا:
```
PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_API_KEY=
PAYMOB_SECRET_KEY=
PAYMOB_PUBLIC_KEY=
PAYMOB_INTEGRATION_ID_CARD=
PAYMOB_INTEGRATION_ID_MOBILE_WALLET=
PAYMOB_HMAC_SECRET=
```

### التأكد إنها اشتغلت

بعد حفظ القيم، جرّب `POST /orders/:id/pay-with-card` على طلب حقيقي
بحالة `work_completed`/`awaiting_payment` — المفروض ترجع `redirect_url` لـ
`https://accept.paymob.com/unifiedcheckout/...`. افتحه في متصفح، أكمل بيانات بطاقة اختبار
(Paymob بتوفر بطاقات اختبار في وضع Test Mode)، وتأكد إن `POST /webhooks/paymob` استقبل الرد
وقفل الطلب `completed`/`paid` فعلاً (`GET /orders/:id`).

### ملاحظة UI

الباك-إند والـ UI جاهزين بالكامل دلوقتي. `apps/customer-app` فيه `CardPaymentScreen` (زرار "ادفع بالبطاقة" في تفاصيل الطلب) بتفتح `redirect_url` في WebView — تفاصيل كاملة في `apps/customer-app/README.md`.

### 1.1 Mobile Wallet (Vodafone Cash/Orange Money/إلخ) — عبر نفس حساب Paymob (docs/08 §19 بند 15)

كانت فجوة موثّقة صراحة في تدقيق المالك: `/pay-with-wallet` الحالي محفظة داخلية للمنصة بس (رصيد
العميل عندنا)، مش محفظة إلكترونية مصرية خارجية حقيقية (Vodafone Cash وشبهها) كـ pay-before-dispatch.
الحل **مش محتاج حساب/اعتماد خارجي جديد** — Paymob (نفس الحساب اللي فوق) بيدعم "Mobile Wallets"
كـ integration type منفصل عن الكارت، وUnified Checkout بتاعه بيعرض خيار المحفظة تلقائيًا في نفس
صفحة الدفع لو الـ integration ID بتاعها موجود ضمن `payment_methods` — صفر منطق backend إضافي،
صفر شاشة Flutter جديدة (نفس `CardPaymentScreen`/WebView الموجودة أصلاً).

**الخطوات**:
1. من **Developers → Payment Integrations** في نفس حساب Paymob: اعمل integration جديد لنوع
   **Mobile Wallet** (منفصل عن Online Card اللي فوق) — هتاخد **Integration ID** رقمي تاني.
2. أضف القيمة دي في `apps/api/.env`:
   ```
   PAYMOB_INTEGRATION_ID_MOBILE_WALLET=<الـ Integration ID بتاع Mobile Wallet>
   ```
3. إعادة تشغيل `apps/api` — `createPayment()` (`paymob-provider.service.ts`) هيضيفها تلقائيًا
   لقايمة `payment_methods` جنب الكارت. متغيّر اختياري بالكامل — من غيره كل حاجة بتفضل شغالة زي
   ما هي (regression-safe، مختبر بـ`paymob-provider.service.spec.ts`).

**التأكد إنها اشتغلت**: بعد ملء القيمة، `POST /orders/:id/pay-with-card` (نفس الـendpoint —
مفيش endpoint جديد لأن Paymob نفسه بيوحّد الاختيار في checkout page واحدة) المفروض يرجّع
`redirect_url` لصفحة فيها خيار "بطاقة" و"محفظة إلكترونية" الاتنين — اختر المحفظة وأكمل بيانات
تجريبية (Paymob بيوفر أرقام محافظ اختبار في Test Mode). باقي دورة التسوية (webhook، `WalletsService`،
إلخ) نفسها بالحرف بغض النظر عن أي طريقة الدفع اللي العميل اختارها جوّه checkout page.

---

## 2. بوابة الدفع بكود مرجعي — FawryPay ("ادفع في أقرب فوري")

**ليه FawryPay بالذات**: أوسع شبكة دفع كاش في مصر (منافذ فوري منتشرة في كل حتة) — طريقة دفع
حقيقية جداً لعملاء من غير كارت بنكي، بالإضافة لـ Paymob مش بديلة ليها. العميل بياخد كود مرجعي
ويدفعه كاش فعلي في أي منفذ، والتأكيد بييجي عبر webhook async زي الدفع بالبطاقة بالظبط.

**الكود**: `apps/api/src/modules/payments/gateways/fawry-gateway.service.ts` — تفاصيل معمارية
كاملة في `apps/api/src/modules/payments/README.md`.

### ⚠️ تحذير مهم قبل الاستخدام الإنتاجي — لازم تتحقق منه

الكود ده مبني على أفضل فهم موثّق لعقد "FawryPay Server-to-Server Charge API" (مسار الـ endpoint،
أسماء الحقول الأساسية، ومنطق SHA-256 للتوقيع) — **لسه محتاج تحقق فعلي ضد sandbox حقيقي قبل أي
استخدام إنتاجي حقيقي بفلوس حقيقية**. الجزء الأكثر عرضة للخطأ تحديداً هو *ترتيب* الحقول في حساب
التوقيع (دالتين في `fawry-gateway.service.ts`: `computeChargeSignature` و`computeWebhookSignature`،
كل واحدة فيها تعليق يوضّح الترتيب المفترض بالظبط). لو رجع رد "توقيع غير صحيح" من FawryPay، أو
webhook اترفض بتوقيع خاطئ رغم إن البيانات صحيحة، **أول حاجة تتأكد منها هي الترتيب ده مقابل
التوثيق الرسمي الحالي من FawryPay** (Merchant Dashboard → Integration → API Docs عند لحظة
قرايتك للملف ده — التوثيق ممكن يتغيّر)، مش أي حاجة تانية في الكود. باقي المنطق (idempotency، تسوية
الطلب، قيود المحفظة المزدوجة، رفض التوقيع الخاطئ، تجاهل التكرار) **اتأكد حياً بالكامل** عبر محاكاة
webhook موقّع يدوياً بالخوارزمية المفترضة نفسها — تفاصيل الاختبار الكامل في
`apps/api/src/modules/payments/README.md`.

### الخطوات

1. اعمل حساب تاجر على [FawryPay](https://www.fawrypay.com) (أو من خلال أي شريك معتمد في مصر).
2. من لوحة تحكم التاجر: هتلاقي **Merchant Code** — ده `FAWRY_MERCHANT_CODE`.
3. من نفس اللوحة (قسم Integration/API Keys): **Secure Key** (أو "Secret Key" حسب تسمية اللوحة
   وقت قرايتك) — ده `FAWRY_SECURE_KEY`، مستخدم في حساب توقيع كل طلب/رد.
4. لو عندك بيئة Sandbox تجريبية منفصلة، URL بتاعها غالباً `https://atfawry.fawrystaging.com`
   (القيمة الافتراضية بالفعل) — للإنتاج غيّرها لـ `https://atfawry.com` (أو القيمة اللي لوحة
   التحكم بتاعتك بتحددها بالظبط).
5. من قسم Webhooks/Callbacks في اللوحة: ضيف
   `https://YOUR_DOMAIN/api/v1/webhooks/fawry` كـ server notification URL.

### مكان القيم

في `apps/api/.env`:
```
FAWRY_BASE_URL=https://atfawry.fawrystaging.com
FAWRY_MERCHANT_CODE=<من الخطوة 2>
FAWRY_SECURE_KEY=<من الخطوة 3>
FAWRY_REFERENCE_EXPIRY_HOURS=72
```

### التأكد إنها اشتغلت

بعد ملء القيم وإعادة تشغيل `apps/api`، جرّب `POST /orders/:id/pay-with-fawry-reference` على طلب
حقيقي بحالة `work_completed`/`awaiting_payment` — المفروض ترجع `reference_number` حقيقي. **أول
حاجة تتأكد منها هنا بالتحديد**: لو الرد رجع رفض غريب (statusCode مش 200 من FawryPay نفسها، أو
رسالة عن توقيع)، ده يأكد إن ترتيب حقول `computeChargeSignature` محتاج تصحيح حسب توثيق FawryPay
الحالي (راجع التحذير فوق) — مش بَقّة تانية في الكود. لو نجح، جرّب دفع الكود فعلياً في منفذ فوري
حقيقي (أو محاكاة من Sandbox لو متاحة)، وتأكد إن `POST /webhooks/fawry` استقبل الرد وقفل الطلب
`completed`/`paid` فعلاً (`GET /orders/:id`).

### ملاحظة UI

الباك-إند والـ UI جاهزين بالكامل دلوقتي. `apps/customer-app` فيه `FawryReferenceScreen` (زرار
"ادفع في أقرب فوري" في تفاصيل الطلب) بتعرض الكود المرجعي مع تاريخ انتهاءه وزرار نسخ — تفاصيل
كاملة في `apps/customer-app/README.md`.

---

## 3. تخزين الملفات — S3-compatible

**اختر واحد من الأربعة** (الكود بيشتغل مع أي منهم من غير أي تعديل، بس `S3_ENDPOINT`):

| الخيار | الأنسب لـ | S3_ENDPOINT محتاج؟ |
|---|---|---|
| AWS S3 | فريق بالفعل على AWS | لأ (سيبه فاضي) |
| DigitalOcean Spaces | بساطة + سعر ثابت | آه |
| Cloudflare R2 | صفر تكلفة egress | آه |
| MinIO (ذاتي الاستضافة) | تحكم كامل/بيانات محلية | آه |

**الكود**: `apps/api/src/common/storage/s3-storage.service.ts` — تفاصيل معمارية (بما فيها قرار
مدة الـ presigned URL) في `apps/api/src/common/storage/README.md`.

### الخطوات (مثال AWS S3 — نفس المنطق للباقي)

1. اعمل bucket جديد (S3 Console → Create bucket). سجّل اسمه (`S3_BUCKET`) والـ region
   (`S3_REGION`، مثال `eu-west-1`).
2. اعمل IAM user جديد بصلاحية `s3:PutObject`/`s3:GetObject` على البucket ده بس (مبدأ أقل صلاحية
   ممكنة — مش صلاحية admin كاملة). من **Security credentials** هتاخد **Access Key ID**
   (`S3_ACCESS_KEY_ID`) و**Secret Access Key** (`S3_SECRET_ACCESS_KEY`).
3. لو مش AWS (Spaces/R2/MinIO): هتلاقي الـ endpoint في لوحة تحكم المزوّد (مثال Spaces:
   `https://nyc3.digitaloceanspaces.com`، R2: `https://<account_id>.r2.cloudflarestorage.com`) —
   ده `S3_ENDPOINT`.

### مكان القيم

في `apps/api/.env`:
```
STORAGE_PROVIDER=s3
S3_ENDPOINT=<فاضي لـ AWS، إلا كده رابط المزوّد>
S3_REGION=<مثال us-east-1>
S3_BUCKET=<اسم الـ bucket>
S3_ACCESS_KEY_ID=<من الخطوة 2>
S3_SECRET_ACCESS_KEY=<من الخطوة 2>
S3_FORCE_PATH_STYLE=true
```

### التأكد إنها اشتغلت

بعد إعادة التشغيل، اللوج المفروض يظهر `S3 storage مُفعّل — bucket=<اسمك>`. جرّب رفع صورة حقيقية
(`POST /technician/orders/:id/media`) — الرد المفروض يرجع `file_url` بيبدأ برابط presigned حقيقي
للـ bucket بتاعك (مش `/uploads/...` المحلي القديم). افتح الرابط في متصفح للتأكد إنه بيعرض الصورة.

---

## 4. الإشعارات — FCM / Twilio / SMTP

الثلاثة مستقلين تماماً عن بعض — فعّل أي واحد فيهم لوحده، الباقي بيفضل log-only من غير أي تأثير.

**الكود**: `apps/api/src/common/notifications/` (`fcm-push-dispatcher.service.ts`,
`twilio-sms-dispatcher.service.ts`, `twilio-whatsapp-dispatcher.service.ts`,
`smtp-email-dispatcher.service.ts`) — تفاصيل معمارية كاملة في
`apps/api/src/modules/notifications/README.md`.

### 4.1 Push — Firebase Cloud Messaging

1. اعمل مشروع على [console.firebase.google.com](https://console.firebase.google.com).
2. **Project Settings (⚙️) → Service Accounts → Generate new private key** — ده بيحمّلّك ملف
   JSON. **افتح الملف وانسخ محتواه كله كسطر واحد** (JSON.stringify، مفيش سطور جديدة).

في `apps/api/.env`:
```
FIREBASE_SERVICE_ACCOUNT_JSON=<محتوى الملف كامل كسطر واحد>
```

**كانت فجوة موثّقة صراحة، اتقفلت جزئياً (كل حاجة كود، لسه محتاجة ملفات إعداد حقيقية منك)**: السيرفر
جاهز *يبعت* push من زمان، والكود بقى جاهز *يستقبل* توكنات ويسجّلها — الجزء الوحيد الناقص فعلياً
دلوقتي هو ملفي الإعداد الحقيقيين اللي محتاجين مشروع Firebase فعلي:

- `firebase_core`/`firebase_messaging` مضافين لـ `pubspec.yaml` في التطبيقين، وفيه
  `lib/core/push_notification_service.dart` جديد فيهم (نفس الكود بالظبط في الاتنين): بعد تسجيل
  الدخول (`AuthRepository.init()`/`verifyOtp()`، fire-and-forget من غير ما يأخّر أو يفشّل تسجيل
  الدخول نفسه) بيعمل `Firebase.initializeApp()`، يطلب إذن الإشعارات، ياخد توكن FCM، ويبعته لـ
  `POST /devices` مع `device_id` ثابت لكل تثبيت (UUID عشوائي متولّد مرة واحدة ومخزّن في
  `flutter_secure_storage` — مش توكن FCM نفسه، لأنه بيتغيّر من وقت للتاني وكان هيعمل صفوف مكررة).
  **فشل صامت ومقصود في كل خطوة**: لو مفيش ملفات Firebase حقيقية لسه، `Firebase.initializeApp()`
  هترمي `PlatformException` وبتتلقّط وتتسجّل في اللوج بس — نفس مبدأ "فشل خدمة خارجية ميوقفش عملية
  حقيقية للمستخدم" المتّبع في كل مكان تاني بالمشروع. اتأكد حياً: `flutter analyze` نضيف في
  التطبيقين، والاختبارات الحية الموجودة (`test_live/otp_flow_live_test.dart`,
  `test_live/order_creation_live_test.dart`) لسه بتعدّي عادي رغم إن `AuthRepository.init()`/
  `verifyOtp()` بقى بيحاول يسجّل جهاز push في الخلفية.
- **Android**: بلجن `com.google.gms.google-services` مُعلَن (`apply false`) في
  `android/settings.gradle.kts`، وتفعيله الفعلي في `android/app/build.gradle.kts` **شرطي**
  (`if (file("google-services.json").exists())`) — عشان `flutter build`/`flutter run` يفضلوا
  شغالين عادي من غير ما ينهاروا لأي حد لسه معندوش مشروع Firebase حقيقي. لما تحط
  `google-services.json` حقيقي في `android/app/`، هيتفعّل تلقائي من غير أي تعديل تاني.
- **iOS**: `GoogleService-Info.plist` لازم يتضاف لـ `ios/Runner/` **وكمان** لمشروع Xcode نفسه
  (مش مجرد نسخ ملف — لازم يتضاف كـ resource في `Runner.xcodeproj` عن طريق Xcode) — الخطوة دي
  مش قابلة للأتمتة من هنا (نفس القيد الموثّق: مفيش macOS/Xcode في البيئة دي)، فسايبنها خطوة يدوية
  صريحة.
- الملفين الاتنين (`android/app/google-services.json`, `ios/Runner/GoogleService-Info.plist`)
  مُضافين لـ `.gitignore` في التطبيقين — نفس منطق `.env`: قيم بيئة حقيقية متتحطش في git.

> **تحديث 2026-08-26 (docs/08 §69)**: مشروع Firebase الحقيقي بقى موجود (`sonaa3-66360`)،
> و**`apps/customer-app/android/app/google-services.json` اتحط فعلاً** — يعني تطبيق العميل على
> أندرويد جاهز يسجّل توكن ويستقبل push بمجرد ما يتبني ويتسجّل فيه دخول. الباقي:
> `technician-app` محتاج تطبيق Android تاني في نفس المشروع بحزمة `com.baytak.technician_app`
> وملفه الخاص، وiOS (التطبيقين) محتاج `GoogleService-Info.plist` + **مفتاح APNs مرفوع** في
> Project Settings → Cloud Messaging (مؤجّل بطلب المالك). الملفات دي في `.gitignore` فكل بيئة
> بناء لازم تحط نسختها.

**الخطوات المتبقية عليك (محتاجة مشروع Firebase حقيقي)**: اعمل مشروع على
[console.firebase.google.com](https://console.firebase.google.com) (لو لسه معملتوش في §الأول)،
ضيف تطبيق Android بـ `applicationId` من `android/app/build.gradle.kts` (`com.baytak.customer_app`
أو `com.baytak.technician_app`) ونزّل `google-services.json` وحطه في `android/app/`، وضيف تطبيق
iOS بـ bundle id من `ios/Runner.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`) ونزّل
`GoogleService-Info.plist` وضيفه لـ `ios/Runner/` عبر Xcode (Add Files to "Runner").

### 4.2 SMS / WhatsApp — Twilio

1. اعمل حساب على [twilio.com](https://www.twilio.com).
2. من الـ Console الرئيسية: **Account SID** (`TWILIO_ACCOUNT_SID`) و**Auth Token**
   (`TWILIO_AUTH_TOKEN`) ظاهرين مباشرة في الصفحة الأولى.
3. للـ SMS: اشتري رقم من **Phone Numbers → Buy a number** (لازم يدعم SMS) — ده
   `TWILIO_SMS_FROM_NUMBER` (بالصيغة الدولية، مثال `+12025551234`).
4. للـ WhatsApp: من **Messaging → Try it out → Send a WhatsApp message** — في وضع Sandbox في
   الأول (تجربة سريعة)، وللإنتاج محتاج WhatsApp Business Profile معتمد من Meta عبر Twilio (خطوة
   أطول، فيها مراجعة من Meta) — الرقم الناتج هو `TWILIO_WHATSAPP_FROM_NUMBER` (من غير بادئة
   `whatsapp:` — الكود بيضيفها تلقائياً).

في `apps/api/.env`:
```
TWILIO_ACCOUNT_SID=<من الخطوة 2>
TWILIO_AUTH_TOKEN=<من الخطوة 2>
TWILIO_SMS_FROM_NUMBER=<من الخطوة 3>
TWILIO_WHATSAPP_FROM_NUMBER=<من الخطوة 4>
```

### 4.3 Email — SMTP

يشتغل مع أي بوابة SMTP قياسية — مش مربوط بـ SDK معيّن. أمثلة شائعة:

- **SendGrid**: `SMTP_HOST=smtp.sendgrid.net`, `SMTP_PORT=587`, `SMTP_USER=apikey`,
  `SMTP_PASSWORD=<SendGrid API key بتاعك>`.
- **Amazon SES**: `SMTP_HOST=email-smtp.<region>.amazonaws.com`, بيانات اعتماد SMTP مخصوصة من
  SES Console (مختلفة عن AWS access keys العادية — لازم تتولّد من SES نفسه).
- **Mailgun**: `SMTP_HOST=smtp.mailgun.org`, بيانات من Mailgun dashboard.

في `apps/api/.env`:
```
SMTP_HOST=<حسب البوابة اللي اخترتها>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<حسب البوابة>
SMTP_PASSWORD=<حسب البوابة>
SMTP_FROM_EMAIL=<بريد المرسل، لازم يكون verified عند أغلب البوابات>
```

### التأكد إنها اشتغلت (الثلاثة)

بعد ملء أي قناة وإعادة التشغيل، جرّب فعل بيولّد إشعار (مثال: `POST /complaints` بيبعت لـ
`ops_manager` عبر قناتي `in_app`+`email`). شوف `notifications` table — `delivery_status` المفروض
`sent` (مش `failed` بسبب "لا توجد بوابة... مُعدّة"). أي فشل حقيقي (بيانات اعتماد غلط) هيظهر في
`failure_reason` بوضوح.

---

## 5. الخرائط — Google Maps

**الكود**: `apps/customer-app` (`google_maps_flutter` — خريطة تتبع حقيقية) و`apps/technician-app`
(`url_launcher` — فتح تطبيق خرائط خارجي، **مش محتاج API key خالص**، راجع تحت).

### الخطوات

1. روح [console.cloud.google.com](https://console.cloud.google.com)، اعمل مشروع جديد (أو استخدم
   مشروع Firebase بتاعك من فوق — نفس منصة Google Cloud).
2. من **APIs & Services → Library**: فعّل **Maps SDK for Android** و**Maps SDK for iOS**.
3. من **APIs & Services → Credentials → Create Credentials → API Key**: هتاخد المفتاح. **مهم
   أمنياً**: قيّده (Restrict key) بـ Android package name / iOS bundle id بتاعك، وبالـ APIs
   اللي فعّلتها بس فوق — مفتاح من غير قيود ممكن يتستخدم من أي حد لقاه.

### مكان القيمة

**مفتاحين منفصلين مستحسن** (واحد Android مقيّد بالـ package name، واحد iOS مقيّد بالـ bundle
id) — أو نفس المفتاح لو مقيّد صح بالاتنين:

- `apps/customer-app/android/app/src/main/AndroidManifest.xml` — داخل `<application>`:
  ```xml
  <meta-data
      android:name="com.google.android.geo.API_KEY"
      android:value="YOUR_GOOGLE_MAPS_API_KEY" />
  ```
  استبدل `YOUR_GOOGLE_MAPS_API_KEY` بالمفتاح الحقيقي.

- `apps/customer-app/ios/Runner/AppDelegate.swift`:
  ```swift
  GMSServices.provideAPIKey("YOUR_GOOGLE_MAPS_API_KEY")
  ```
  استبدل `YOUR_GOOGLE_MAPS_API_KEY` بالمفتاح الحقيقي.

### apps/customer-app — نسخة الويب (Flutter Web) — كانت فجوة حقيقية، اتقفلت (2026-08-19)

`google_maps_flutter_web` (اللي بيشغّل الخريطة لما التطبيق يتبني للويب — `flutter build web`/
`flutter run -d chrome`) محتاج مكتبة Google Maps JavaScript API محمّلة في صفحة HTML نفسها **قبل**
أي محاولة لعرض `GoogleMap` widget — بعكس Android/iOS، Flutter مش بيحقن السكريبت ده تلقائيًا خالص.
`apps/customer-app/web/index.html` كان لسه الـtemplate الافتراضي 100% بلا أي وسم Maps — يعني
`window.google.maps` تفضل `undefined` مهما كان المفتاح نفسه صح وموجود في مفتاح Android/iOS، والخطأ
اللي بيظهر (`TypeError: Cannot read properties of undefined (reading 'maps')`) **مالوش أي علاقة
بموقع/بلد المستخدم** — نفس السلوك هيحصل من أي مكان في الدنيا.

**الإصلاح**: `<script src="https://maps.googleapis.com/maps/api/js?key=...">` مضاف في `<head>` بـ
`web/index.html`، بنفس المفتاح الموجود بالفعل في `AndroidManifest.xml`/`AppDelegate.swift`. **خطوة
لازم تتعمل من Google Cloud Console (مفيش وصول لها من هنا)**: المفتاح ده كان مفعّل ليه Maps SDK for
Android/iOS بس — لازم **Maps JavaScript API** تتفعّل ليه هي كمان (APIs & Services → Library)، ولو
عنده قيود HTTP referrer، لازم الدومين اللي التطبيق شغال عليه يتضاف (`localhost:*` وقت التطوير
المحلي). لو بعد سحب الإصلاح ده لسه فيه خطأ في الـconsole زي `InvalidKeyMapError` أو
`RefererNotAllowedMapError`، ده معناه المفتاح نفسه محتاج التعديل ده من Cloud Console، مش كود جديد.

### apps/technician-app — مفيش حاجة تتحط

زرار "افتح الملاحة للعنوان" بيستخدم رابط عام
(`https://www.google.com/maps/dir/?api=1&destination=lat,lng`) بيفتح تطبيق خرائط مثبّت (أو
المتصفح) — **من غير أي API key أو إعداد إضافي خالص**. قرار تصميم متعمّد (راجع
`apps/technician-app/README.md`) — مش محتاج تعمل حاجة هنا.

### التأكد إنها اشتغلت

بعد ملء المفتاح، شغّل `apps/customer-app` على جهاز/إيموليتور حقيقي (**البيئة دي مفيهاش واحد —
فجوة موثّقة قديمة، مش جديدة**)، افتح شاشة "تتبّع الفني لحظياً" لطلب نشط — المفروض تشوف خريطة
حقيقية بتايلز، مش شاشة رمادية فاضية أو رسالة خطأ. لو الخريطة رمادية/فاضية غالباً المفتاح مش صحيح
أو الـ API مش مفعّلة في Google Cloud Console.

---

## 6. معاينات معرض أعمال الفني — Facebook Graph API (اختياري)

معرض أعمال الفني (لينكات فيديوهات في بروفايله العام) بيدعم 4 منصات: تيك توك، يوتيوب، انستجرام،
فيسبوك. **تيك توك ويوتيوب عندهم oEmbed عام بلا أي مفتاح — شغالين من غير أي إعداد منك خالص.**
انستجرام وفيسبوك بقى Meta غيّرت الـ oEmbed العام بتاعهم لمحتاج access token من تطبيق Facebook
Developer حقيقي — من غيره لينكات انستجرام/فيسبوك **لسه بتتحفظ عادي** بس من غير صورة معاينة
(thumbnail) تلقائية.

### الخطوات (اختياري — بس لو عايز معاينات انستجرام/فيسبوك)

1. اعمل تطبيق على [developers.facebook.com](https://developers.facebook.com) (قسم My Apps → Create App).
2. من إعدادات التطبيق، هات **App Access Token** (أو Page Access Token لو محتاج صلاحيات أوسع —
   الـ oEmbed العام بيكفي App Access Token البسيط).

### مكان القيمة

مش env var — إعداد داخل محرك `/settings` في `apps/admin` (زي نقاط الولاء):

```
group_name: social
key: social.facebook_graph_access_token
```

عدّله من `/settings` مباشرة — قيمة نصية، مفيش حاجة تتعمل من الكود.

### التأكد إنها اشتغلت

بعد ما تحط المفتاح، أي لينك انستجرام/فيسبوك جديد يتضاف (`POST /technician/portfolio-links`)
المفروض يرجع `thumbnail_url` مليان بدل `null`. اللينكات القديمة اللي اتضافت قبل ما تحط المفتاح
مش هتتحدّث تلقائياً — لازم تتحذف وتتضاف تاني لو عايز معاينة.

---

## 7. توقيع Android للإصدار (Release Signing)

`apps/customer-app` و`apps/technician-app` بيبنوا بتوقيع debug افتراضيًا — ده كويس للتطوير
(`flutter run --release` شغال من غير أي إعداد) بس Google Play Store برفض رفع APK/AAB بتوقيع
debug. الملفين `apps/customer-app/android/app/build.gradle.kts` و
`apps/technician-app/android/app/build.gradle.kts` فيهم نفس النمط الشرطي المستخدم بالفعل مع
`google-services.json`: لو `android/key.properties` (كل تطبيق عنده نسخته الخاصة) موجود، بيتفعّل
توقيع الإصدار الحقيقي تلقائيًا؛ من غيره البناء يفضل شغال بتوقيع debug زي الأول.

### الخطوات (لكل تطبيق — customer-app وtechnician-app منفصلين، كل واحد له keystore خاص بيه)

1. ولّد keystore حقيقي (مرة واحدة لكل تطبيق، واحفظه في مكان آمن برّه الـ repo — لو ضاع مينفعش
   تحدّث نفس التطبيق على Play Store تاني):

   ```bash
   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 \
     -validity 10000 -alias upload
   ```

   هيسألك عن `storePassword` و`keyPassword` (ينفع يبقوا نفس القيمة) واسم/تنظيم — احفظهم.

2. انسخ `apps/customer-app/android/key.properties.example` لـ
   `apps/customer-app/android/key.properties` (والمكافئ لـ `technician-app`)، واملأ القيم
   الأربعة (`storePassword`, `keyPassword`, `keyAlias`, `storeFile` — مسار الـ `.jks` اللي
   ولّدته فوق، نسبي لمجلد `android/` أو مطلق).

3. الملف `key.properties` نفسه في `.gitignore` بالفعل (`apps/*/android/.gitignore`) — أبدًا
   متعملوش commit، ده سر إصدار حقيقي زي كلمة سر قاعدة بيانات.

### التأكد إنها اشتغلت

```bash
cd apps/customer-app && flutter build appbundle --release
```

لو `key.properties` موجود وصح، البناء يعدي عادي وينتج AAB بتوقيع الإصدار الحقيقي (تقدر تتأكد
بـ `jarsigner -verify -verbose -certs build/app/outputs/bundle/release/app-release.aab` أو
`apksigner verify` على APK). لو `key.properties` مش موجود، نفس الأمر يعدي برضه بس بتوقيع debug —
مفيش أي فشل في أي الحالتين، ده العمد.

### ملاحظة مهمة

بناء AAB/APK حقيقي محتاج Android SDK/NDK كامل — البيئة السحابية اللي بيتطور فيها الكود دلوقتي
مفيهاش SDK كامل للـ build الفعلي، فالتحقق اللي اتعمل هنا كان مراجعة syntax الـ Kotlin DSL يدويًا
+ مطابقته لنفس نمط `google-services.json` الشرطي الشغال بالفعل في نفس الملفين — مش تنفيذ build
حقيقي. أول مرة حد يعمل build فعلي (لوكال أو CI بعتاد Android SDK) لازم يتأكد إن الأمر فوق بيعدي.

---

## 8. الدفع بالتحويل اليدوي — InstaPay

**ليه InstaPay بالذات**: شبكة التحويل الفوري الرسمية للبنك المركزي المصري، منتشرة جداً بين
العملاء اللي مش عايزين يدخلوا بيانات كارت أو يقفوا في طابور فوري — تحويل مباشر بس بعنوان IPA أو
رقم موبايل مسجّل. **مفيش API رسمي متاح لمنصات تجارية عادية دلوقتي** (على عكس Paymob/Fawry فوق)،
فالتأكيد كله يدوي: العميل بيحوّل بنفسه من تطبيق بنكه، وموظف Finance بيأكّد الاستلام بعد ما يشوف
التحويل فعلاً في الحساب.

**الكود**: `apps/api/src/modules/payments/gateways/instapay-provider.service.ts` (يرجّع تعليمات
تحويل بس، مش رابط دفع) + `POST /admin/payments/:id/confirm-instapay` (تأكيد) و
`POST /admin/payments/:id/reject-instapay` (رفض) في `admin-payments.controller.ts` — تفاصيل
معمارية كاملة في `apps/api/src/modules/payments/README.md`.

### الفرق الجوهري عن Paymob/Fawry فوق — **مش env vars خالص، إعداد أدمن ديناميكي**

القيمتين المحتاجين هنا مش مفاتيح API بترتبط بحساب تاجر حقيقي — هما بس نص بيتعرض للعميل كتعليمات
("حوّل لـ..."). عشان كده (وعشان ممكن يتغيروا — تغيير حساب بنكي مثلاً) **بقوا يتعدّلوا من لوحة
تحكم الأدمن مباشرة (`/admin/settings`)، مش من `.env`** (طلب مالك صريح 2026-08-20، §33 في
`docs/08-pricing-engine-and-platform-vision.md`) — تغيير لحظي بلا إعادة نشر أو restart للسيرفر،
ومحدود لـ`super_admin` بس (نفس تقييد كل `/admin/settings`، صلاحية `settings.manage`).

### الخطوات

1. سجّل دخول كـ`super_admin` في `apps/admin` → **الإعدادات** (`/settings`، ظاهرة لـ`super_admin`
   بس في الشريط الجانبي).
2. في مجموعة **payments**، هتلاقي صفين: `payments.instapay.ipa_address` و
   `payments.instapay.recipient_name`.
3. لو عندك حساب بنكي مصري (أو محفظة موبايل) مسجّل InstaPay: من تطبيق البنك → إعدادات InstaPay →
   هتلاقي **IPA Address** بتاعك (شكله زي `name@bankcode` أو رقم موبايلك المسجّل) — دي القيمة
   الأولى. الاسم اللي هيتعرض للعميل عشان يتطمّن إنه بيحوّل للجهة الصح — دي القيمة التانية.
4. للتجربة بس (مفيش فلوس حقيقية بتتحرك، ده مجرد نص تعليمات): أي قيمتين وهميتين (زي
   `test@instapay` واسم تجريبي) شغالين فورًا من غير ما تستنى اعتماد أي جهة خارجية. للاستخدام
   الحقيقي بفلوس حقيقية، القيمتين دول لازم يبقوا عنوان IPA وحساب استلام حقيقيين مسجّلين باسم
   الشركة.
5. عدّل القيمة في خانة النص واضغط "حفظ" — التغيير سارٍ فورًا (لحظيًا، مفيش restart مطلوب) بمجرد
   ما القيمتين الاتنين بيبقوا مليانين.
6. **(اختياري) كود QR** — من `apps/admin` → **تأكيدات InstaPay** (`/instapay-confirmations`)،
   في كارت «كود QR لاستقبال تحويلات InstaPay» فوق الطابور:
   - **ارفع صورة**: من تطبيق البنك → InstaPay → «استقبال أموال / Request Money» فيه QR ثابت
     لحسابك — صوّره أو حمّله واختاره هنا (PNG/JPEG/WEBP، حتى 5MB).
   - **أو استخدم رابط**: لو الصورة مستضافة عندك بالفعل، الصق رابط `https://` (http مرفوض عمدًا —
     صورة QR بتتحمّل بلا تشفير قابلة للتبديل في الطريق، والنتيجة إن فلوس العميل تروح لحساب تاني).
   الاتنين بيكتبوا في نفس الإعداد (`payments.instapay.qr_image`)، فالأحدث بيكسب. **الـQR اختياري
   بالكامل**: من غيره شاشة الدفع بتعرض التعليمات النصية بس وكل حاجة بتشتغل عادي.

### التأكد إنها اشتغلت

بعد ملء القيمتين من `/settings`، جرّب `POST /orders/:id/pay-with-instapay` على طلب حقيقي —
المفروض ترجع `instructions_ar` فيها العنوان والاسم اللي حطيتهم + `reference_code`. من `apps/customer-app`
اضغط "حوّلت الفلوس" في `InstaPayReferenceScreen` — لازم يسجّل `customer_confirmed_transfer_at` (يظهر
فورًا في `apps/admin` → **تأكيدات InstaPay**، `/instapay-confirmations`). اضغط "تأكيد الاستلام" من
هناك — `GET /orders/:id` المفروض يرجع `payment_status: paid`.

### ملاحظة UI

الباك-إند وواجهات الثلاث تطبيقات جاهزين بالكامل: `apps/customer-app` فيه `InstaPayReferenceScreen`
(زرار "حوّلت الفلوس" بيسجّل تبليغ العميل، مش بس polling محلي، وكارت QR بيظهر لو الأدمن ضبط
واحد)، `apps/admin` فيه شاشة طابور مخصوصة
(`/instapay-confirmations`) بتجمّع كل الدفعات المعلّقة في مكان واحد بدل ما موظف Finance يدوّر
طلب-طلب، وموظف Finance بياخد إشعار in-app فوري لما العميل يبلّغ التحويل + إشعار مخصوص للعميل لما
التحويل يتأكّد. تفاصيل كاملة في `docs/08-pricing-engine-and-platform-vision.md` §28.5.

---

## ملخص سريع — كل الـ env vars في مكان واحد

انسخ `apps/api/.env.example` لـ `apps/api/.env` واملأ اللي عايزه بس (الباقي فاضي = القناة دي
log-only/معطّلة بأمان، مش هتكسر حاجة):

```bash
# Paymob (§1)
SETTINGS_ENCRYPTION_KEY=
PAYMOB_API_KEY=
PAYMOB_SECRET_KEY=
PAYMOB_PUBLIC_KEY=
PAYMOB_INTEGRATION_ID_CARD=
PAYMOB_INTEGRATION_ID_MOBILE_WALLET=
PAYMOB_HMAC_SECRET=

# FawryPay (§2) — تحذير: راجع "تحذير مهم قبل الاستخدام الإنتاجي" في القسم ده قبل الاعتماد عليها
FAWRY_MERCHANT_CODE=
FAWRY_SECURE_KEY=

# InstaPay (§8) مش env var خالص — يتظبط من apps/admin → الإعدادات (super_admin بس)

# S3 storage (§3)
STORAGE_PROVIDER=local   # غيّرها لـ s3 لما تملأ الباقي
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Notifications (§4)
FIREBASE_SERVICE_ACCOUNT_JSON=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM_NUMBER=
TWILIO_WHATSAPP_FROM_NUMBER=
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
```

وملفين تانيين (مش env vars، إعداد ملفات مباشر):

```
apps/customer-app/android/app/src/main/AndroidManifest.xml  → com.google.android.geo.API_KEY (§5)
apps/customer-app/ios/Runner/AppDelegate.swift               → GMSServices.provideAPIKey (§5)
```

---

## فجوات متبقية صراحة (مش هتتقفل بمجرد ملء قيم فوق)

- **معاينات انستجرام/فيسبوك في معرض أعمال الفني (§6)**: تيك توك ويوتيوب شغالين فوراً بلا إعداد،
  بس انستجرام/فيسبوك محتاجين `social.facebook_graph_access_token` (إعداد في `/settings`، مش env
  var) — من غيره اللينكات لسه بتتحفظ عادي بس من غير صورة معاينة.
- ~~FCM client-side: محتاج `google-services.json`/`GoogleService-Info.plist` + كود Flutter جديد~~
  — **اتقفلت جزئياً**: كل كود Flutter جاهز (`push_notification_service.dart` في التطبيقين،
  `POST /devices` بيتنادى تلقائي بعد تسجيل الدخول)، وبلجن Android مُعلَن وشرطي (مش هيكسر أي حاجة
  من غير ملف). لسه محتاج منك فعلياً: `google-services.json`/`GoogleService-Info.plist` من مشروع
  Firebase حقيقي بتاعك — تفاصيل كاملة في §4.1 فوق.
- **بوابة WhatsApp Business المعتمدة**: Sandbox شغال فوراً بعد ملء القيم، لكن رقم إنتاج حقيقي
  محتاج مراجعة واعتماد من Meta عبر Twilio (أيام لحد أسابيع، خارج تحكمنا).
- ~~دفع البطاقة في `apps/customer-app`: الباك-إند جاهز (§1)، الـ UI (شاشة WebView) لسه لأ~~ — **اتقفلت**: `CardPaymentScreen` جديدة (`webview_flutter`) + زرار "ادفع بالبطاقة"، تفاصيل كاملة في `apps/customer-app/README.md`.
- **بوابة FawryPay (§2) — تحقق التوقيع محتاج مراجعة قبل الإنتاج**: الكود جاهز بالكامل (مسار الـ
  endpoints، تسجيل الدفعة، التسوية، الـ UI) واتأكد حياً إن كل حاجة **غير** مرتبطة مباشرة بشكل رد
  FawryPay الحقيقي شغالة صح (idempotency، قيود المحفظة، رفض التوقيع الخاطئ، تجاهل webhook مكرر —
  عبر محاكاة webhook موقّع يدوياً). **اللي لازم تتأكد منه قبل أي استخدام حقيقي بفلوس حقيقية**:
  ترتيب حقول حساب التوقيع (`computeChargeSignature`/`computeWebhookSignature` في
  `fawry-gateway.service.ts`) مقابل التوثيق الرسمي الحالي من FawryPay — راجع "⚠️ تحذير مهم" في
  §2 فوق لتفاصيل كاملة عن ليه ده تحديداً مش قابل للتأكيد من غير sandbox حقيقي.
- **اختبار بصري حقيقي للخريطة/الإشعارات/شاشات الدفع (بطاقة وكود فوري)**: البيئة دي مفيهاش جهاز/إيموليتور Android أو iOS حقيقي
  — كل حاجة اتأكدت منطقياً وحياً على مستوى الـ API/الكود، مش بصرياً على تطبيق شغال فعلي. أول
  حاجة تعملها بعد ما تحط المفاتيح الحقيقية: تشغيل التطبيقين على جهاز حقيقي والتأكد بصرياً.
