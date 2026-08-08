# 03 — دليل ربط الخدمات الخارجية

الكود بتاع كل تكامل خارجي في baytak **جاهز 100% ومختبر حي** بالقدر اللي البيئة دي سمحت بيه (مفيش
إنترنت خارجي متاح وقت البناء). كل حاجة محتاجة اعتماد حقيقي (API key/secret/حساب) بترجع رفض واضح
(مش انهيار، مش نجاح وهمي) لحد ما تحطّ القيم الحقيقية. الملف ده بيقولّك بالظبط: كل قيمة محتاجاها
منين، وتحطها فين، وإزاي تتأكد إنها اشتغلت.

**القاعدة العامة**: أي env var في `apps/api/.env` (نسخة من `apps/api/.env.example`) فاضية أو ناقصة
= الميزة المرتبطة بيها بترجع لسلوك آمن افتراضي (log-only للإشعارات، تخزين محلي، رفض واضح للدفع
بالبطاقة) — النظام كله بيفضل شغال من غيرها، بس الميزة دي بس مش متفعّلة.

---

## 1. بوابة الدفع بالبطاقة — Paymob

**ليه Paymob بالذات**: أشهر بوابة دفع مصرية، مطابقة لعملة EGP اللي كل أسعار baytak بيها بالفعل،
وموثّقة في `docs/01-master-plan.md` من الأول كخيار أساسي.

**الكود**: `apps/api/src/modules/payments/gateways/paymob-gateway.service.ts` (تكامل حقيقي مع
Accept API v1) — تفاصيل معمارية كاملة في `apps/api/src/modules/payments/README.md`.

### الخطوات

1. اعمل حساب على [accept.paymob.com](https://accept.paymob.com) (Egypt أو المنطقة المناسبة لك).
2. من لوحة التحكم → **Settings → Account Info**: هتلاقي **API Key** — ده `PAYMOB_API_KEY`.
3. من **Developers → Payment Integrations**: اعمل integration جديد لنوع **Online Card** — هتاخد
   **Integration ID** رقمي — ده `PAYMOB_INTEGRATION_ID_CARD`.
4. من **Developers → iframes**: اعمل iframe جديد واربطه بالـ integration اللي عملته فوق —
   هتاخد **Iframe ID** — ده `PAYMOB_IFRAME_ID`.
5. من نفس صفحة الـ Payment Integration اللي عملته: هتلاقي **HMAC Secret** (منفصل تماماً عن الـ
   API Key — ده اللي بيتحقق منه توقيع ردود الـ webhook) — ده `PAYMOB_HMAC_SECRET`.
6. من **Developers → Webhooks**: ضيف الـ callback URL بتاعك:
   `https://YOUR_DOMAIN/api/v1/webhooks/paymob` (استبدل `YOUR_DOMAIN` بدومين السيرفر الحقيقي وقت
   النشر).

### مكان القيم

في `apps/api/.env`:
```
PAYMOB_BASE_URL=https://accept.paymob.com
PAYMOB_API_KEY=<من الخطوة 2>
PAYMOB_INTEGRATION_ID_CARD=<من الخطوة 3>
PAYMOB_IFRAME_ID=<من الخطوة 4>
PAYMOB_HMAC_SECRET=<من الخطوة 5>
```

### التأكد إنها اشتغلت

بعد ملء القيم وإعادة تشغيل `apps/api`، جرّب `POST /orders/:id/pay-with-card` على طلب حقيقي
بحالة `work_completed`/`awaiting_payment` — المفروض ترجع `redirect_url` حقيقي بيبدأ بـ
`https://accept.paymob.com/api/acceptance/iframes/...`. افتحه في متصفح، أكمل بيانات بطاقة اختبار
(Paymob بتوفر بطاقات اختبار في وضع Test Mode)، وتأكد إن `POST /webhooks/paymob` استقبل الرد
وقفل الطلب `completed`/`paid` فعلاً (`GET /orders/:id`).

### ملاحظة UI

الباك-إند والـ UI جاهزين بالكامل دلوقتي. `apps/customer-app` فيه `CardPaymentScreen` (زرار "ادفع بالبطاقة" في تفاصيل الطلب) بتفتح `redirect_url` في WebView — تفاصيل كاملة في `apps/customer-app/README.md`.

---

## 2. تخزين الملفات — S3-compatible

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

## 3. الإشعارات — FCM / Twilio / SMTP

الثلاثة مستقلين تماماً عن بعض — فعّل أي واحد فيهم لوحده، الباقي بيفضل log-only من غير أي تأثير.

**الكود**: `apps/api/src/common/notifications/` (`fcm-push-dispatcher.service.ts`,
`twilio-sms-dispatcher.service.ts`, `twilio-whatsapp-dispatcher.service.ts`,
`smtp-email-dispatcher.service.ts`) — تفاصيل معمارية كاملة في
`apps/api/src/modules/notifications/README.md`.

### 3.1 Push — Firebase Cloud Messaging

1. اعمل مشروع على [console.firebase.google.com](https://console.firebase.google.com).
2. **Project Settings (⚙️) → Service Accounts → Generate new private key** — ده بيحمّلّك ملف
   JSON. **افتح الملف وانسخ محتواه كله كسطر واحد** (JSON.stringify، مفيش سطور جديدة).

في `apps/api/.env`:
```
FIREBASE_SERVICE_ACCOUNT_JSON=<محتوى الملف كامل كسطر واحد>
```

**فجوة موثّقة صراحة — مهمة**: ده بس نص الطريق. السيرفر دلوقتي جاهز *يبعت* push، بس
`apps/customer-app`/`apps/technician-app` **لسه من غير أي تكامل عميل لـ FCM خالص** — مفيش
`firebase_messaging` package، مفيش طلب إذن إشعارات، ومفيش نداء لـ `POST /devices` (اللي أصلاً
موجود وشغال في الباك-إند) لتسجيل الـ FCM token. السبب: تفعيل `firebase_messaging` عملياً محتاج
`google-services.json` (Android) و`GoogleService-Info.plist` (iOS) — دول مش env vars بتتحط،
دول ملفات إعداد محدّدة بالظبط لمشروع Firebase + package name/bundle id بتاعك، لازم تتحمّل من
Firebase Console بعد ما تضيف تطبيقاتك (Android package: راجع `applicationId` في
`android/app/build.gradle.kts`؛ iOS bundle id: راجع `PRODUCT_BUNDLE_IDENTIFIER` في
`ios/Runner.xcodeproj`) وتتحط في مكانها الصح جوّه كل مشروع Flutter. لما تعمل كده، خطوات الربط
هي: (1) حمّل الملفين وحطهم في `android/app/` و`ios/Runner/`، (2) ضيف `firebase_core` +
`firebase_messaging` لـ `pubspec.yaml` الاتنين، (3) بعد تسجيل الدخول اطلب إذن الإشعارات
(`FirebaseMessaging.instance.requestPermission()`)، خد التوكن
(`FirebaseMessaging.instance.getToken()`)، وابعته لـ `POST /devices` (`fcm_token`, `platform`).

### 3.2 SMS / WhatsApp — Twilio

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

### 3.3 Email — SMTP

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

## 4. الخرائط — Google Maps

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

## ملخص سريع — كل الـ env vars في مكان واحد

انسخ `apps/api/.env.example` لـ `apps/api/.env` واملأ اللي عايزه بس (الباقي فاضي = القناة دي
log-only/معطّلة بأمان، مش هتكسر حاجة):

```bash
# Paymob (§1)
PAYMOB_API_KEY=
PAYMOB_INTEGRATION_ID_CARD=
PAYMOB_IFRAME_ID=
PAYMOB_HMAC_SECRET=

# S3 storage (§2)
STORAGE_PROVIDER=local   # غيّرها لـ s3 لما تملأ الباقي
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# Notifications (§3)
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
apps/customer-app/android/app/src/main/AndroidManifest.xml  → com.google.android.geo.API_KEY (§4)
apps/customer-app/ios/Runner/AppDelegate.swift               → GMSServices.provideAPIKey (§4)
```

---

## فجوات متبقية صراحة (مش هتتقفل بمجرد ملء قيم فوق)

- **FCM client-side** (§3.1): محتاج `google-services.json`/`GoogleService-Info.plist` + كود
  Flutter جديد، مش بس env var — تفاصيل كاملة فوق.
- **بوابة WhatsApp Business المعتمدة**: Sandbox شغال فوراً بعد ملء القيم، لكن رقم إنتاج حقيقي
  محتاج مراجعة واعتماد من Meta عبر Twilio (أيام لحد أسابيع، خارج تحكمنا).
- ~~دفع البطاقة في `apps/customer-app`: الباك-إند جاهز (§1)، الـ UI (شاشة WebView) لسه لأ~~ — **اتقفلت**: `CardPaymentScreen` جديدة (`webview_flutter`) + زرار "ادفع بالبطاقة"، تفاصيل كاملة في `apps/customer-app/README.md`.
- **اختبار بصري حقيقي للخريطة/الإشعارات/شاشة الدفع بالبطاقة**: البيئة دي مفيهاش جهاز/إيموليتور Android أو iOS حقيقي
  — كل حاجة اتأكدت منطقياً وحياً على مستوى الـ API/الكود، مش بصرياً على تطبيق شغال فعلي. أول
  حاجة تعملها بعد ما تحط المفاتيح الحقيقية: تشغيل التطبيقين على جهاز حقيقي والتأكد بصرياً.
