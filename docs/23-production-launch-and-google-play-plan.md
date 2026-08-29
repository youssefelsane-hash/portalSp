# خطة الإطلاق الفعلي وGoogle Play — أسطى (OSTA)

> الجهة المشغّلة: الصانع جروب — ELSANE Group.

آخر تحديث: 2026-08-29

هذا المستند هو مرجع الإطلاق التنفيذي الحالي للمشروع. ملفات التدقيق القديمة تثبت جودة أجزاء كثيرة من
الكود، لكنها لا تعني وحدها أن المنصة جاهزة لاستقبال مستخدمين وفلوس حقيقية. الإطلاق يحصل فقط بعد
إغلاق بوابات `P0` الموجودة هنا وتجربة الدورة كاملة على بيئة Production حقيقية.

## 1. القرار المختصر

نبدأ بنسخة **اختبار مغلق** وليست إتاحة عامة:

1. ننشر الـAPI ولوحة الإدارة وموقع العميل على دومينات حقيقية وبيئة Production منفصلة.
2. نرفع تطبيق العميل وتطبيق الفني كتطبيقين منفصلين على Google Play Internal Testing.
3. نختبر داخليًا على 3–5 أجهزة لمدة 2–3 أيام.
4. ننقل التطبيقين إلى Closed Testing مع 15 مختبرًا لمدة 14 يومًا متصلة.
5. لا نفتح Production إلا بعد نجاح الدفع، الاسترجاع، الإشعارات، المطابقة، والنسخ الاحتياطي فعليًا.
6. بعد الموافقة نستخدم طرحًا تدريجيًا: `5% → 20% → 50% → 100%`، وليس نشرًا كاملًا مرة واحدة.

الاختبار الداخلي والمغلق لا يجعل التطبيق ظاهرًا للعامة في البحث؛ المختبر يدخل من رابط الانضمام. كل
تطبيق له قائمة مختبرين ورابط إصدار مستقلان.

## 2. التكلفة الأقل المناسبة للبداية

### البنية المقترحة

| الجزء | الاختيار الأول | تكلفة البداية المتوقعة | لماذا |
|---|---|---:|---|
| API + Admin + Customer Web | Railway Hobby | نحو 5–15 دولار/شهر حسب الاستهلاك | نشر وإعادة تشغيل وLogs وSecrets بدون إدارة سيرفر يدوي |
| PostgreSQL + PostGIS | Neon | مجاني للاختبار الخفيف، ثم Launch عند الحاجة | Managed DB، نسخ واسترجاع، ويتوقف عند الخمول في الخطة المجانية |
| Redis / BullMQ | Upstash Redis | مجاني حتى الحدود الصغيرة | مناسب للطوابير والجلسات في أول عشرات المستخدمين |
| الصور والمستندات | Cloudflare R2 | غالبًا مجاني في البداية | S3-compatible والكود يدعمه، وبدون رسوم خروج بيانات كبيرة |
| Push + Crash reports | Firebase | مجاني | FCM + Crashlytics + Analytics + App Distribution |
| مراقبة API | Better Stack | مجاني في البداية | Health checks وتنبيه عند توقف الخدمة وLogs محدودة |
| DNS / HTTPS / حماية أولية | Cloudflare Free | مجاني | DNS وTLS وبعض الحماية الأساسية |
| OTP SMS | Twilio حاليًا | حسب كل رسالة | الكود الحالي يعتمد عليه؛ النسخة التجريبية لا تصلح لعامة الناس |
| الدفع | Paymob أولًا | عمولة تعاقدية لكل عملية | التكامل الحالي أوضح وأجهز من Fawry للإطلاق الأول |
| Google Play | حساب Full Distribution | 25 دولار مرة واحدة | حساب واحد ينشر التطبيقين |
| الدومين | مزود دومينات موثوق | نحو 10–20 دولار/سنة | روابط API والسياسة والحذف والدعم |

**الميزانية الواقعية للنسخة المغلقة:** رسوم Google Play والدومين مرة واحدة، ثم تقريبًا 5–15 دولارًا
شهريًا، بالإضافة لرسائل OTP وعمولات عمليات الدفع الحقيقية. Firebase وR2 وRedis وDB غالبًا تظل داخل
الحدود المجانية مع 15 مختبرًا، لكن يجب وضع Budget Alerts على أي خدمة تقبل بطاقة دفع.

الخطة المجانية لقاعدة البيانات **ليست النسخة الاحتياطية الوحيدة**. حتى في الاختبار المغلق، نحتفظ
بنسخة مستقلة خارج مزود قاعدة البيانات.

## 3. الحسابات والأوراق المطلوبة منك

### مطلوب الآن

- دومين رسمي، مثل `sanaa.app`، مع عناوين ثابتة: `api` و`admin` و`www` أو ما يعادلها.
- حساب Google Play Full Distribution. لو النشاط باسم شركة، Google يوصي بحساب Organization، وهو
  يحتاج D-U-N-S وموقع شركة. استخراج D-U-N-S قد يستغرق حتى 30 يومًا، لذلك ابدأ به مبكرًا.
- حساب Firebase واحد للمشروع، وداخله Android App للعميل وAndroid App للفني، كل واحد بالـpackage ID
  النهائي الخاص به.
- حساب Paymob Merchant بوضع Test ثم Live، ومستندات الشركة/التاجر التي يطلبها Paymob.
- حساب Twilio مدفوع أو مزود SMS مصري بديل بعد بناء adapter له. Trial يرسل فقط لأرقام موثقة، فلا
  يصلح للإطلاق الحقيقي.
- Google Cloud Billing + مشروع Maps، مع مفاتيح منفصلة للعميل Android وWeb وأي استخدام Server.
- حسابات Railway وNeon وUpstash وCloudflare وBetter Stack.
- بريد دعم رسمي ورقم دعم فعليان يظهران في المتجر والسياسات وداخل التطبيق.
- اسم المطور، اسم الشركة القانوني، العنوان، رقم الهاتف، وسياسة الاحتفاظ بالبيانات.

### مطلوب قبل أول عملية حقيقية

- مراجعة محاسب/محامٍ مصري لطريقة تحصيل العمولة والفواتير والضريبة وعقود الفنيين وحماية البيانات.
- سياسة خصوصية وشروط استخدام وسياسة إلغاء/استرجاع منشورة على روابط عامة ثابتة بالعربية.
- تحديد مدة الاحتفاظ بالرقم القومي وصور المستندات، ومن يملك صلاحية رؤيتها، وكيف تُحذف.
- اتفاق واضح مع Paymob على الرسوم، الـsettlement، الـrefunds، والـchargebacks.

## 4. بوابات P0 التي تمنع النشر العام الآن

هذه ليست تحسينات تجميلية؛ أي بند غير مغلق هنا يعني `NO-GO`:

### P0-1 — سياسة الخصوصية وحذف الحساب — **اتقفلت في الكود (2026-08-29)**

اللي خلص فعليًا (ADR-0053، docs/08 §99):

- **ثلاث صفحات ويب عامة** (مفيش أي فحص جلسة — لو طلبت تسجيل دخول عشان تُقرأ ما بتحققش المتطلَّب
  أصلاً): `/legal/terms`، `/legal/privacy`، `/legal/account-deletion`. الاتنين الأولانيين
  بيتبنوا من **مصدر نص واحد** (`apps/customer-web/src/lib/legal-content.ts`) — ممنوع أي نسخة
  تانية من النص القانوني في أي مكان.
- **فوتر في كل صفحة** فيه الروابط التلاتة + `© ELSANE Group` وحقوق الملكية الفكرية.
- **الحذف بقى إخفاء هوية فعلي مش تعطيل صامت**: الاسم/الرقم/الإيميل/الصورة/الرقم القومي/العناوين
  بتتنضّف فعليًا، أجهزة الإشعارات بتتمسح، ووسائل الدفع بتتلغي — كله في transaction واحدة. راجع
  ADR-0053 لسبب رفض الـ`DELETE` الصريح (سجلات مالية بتخص أطراف تانية).
- **حارس جديد**: مينفعش حذف والمستخدم عنده طلب لسه شغال (كان فيه فحص رصيد المحفظة بس).

**اللي لسه مفتوح هنا**:

- زرار حذف الحساب **جوّه تطبيق العميل وتطبيق الفني** (المسار الويب والـAPI جاهزين، ناقص الواجهة).
- **ملفات التخزين نفسها مش بتتمسح** — `technician_documents.file_url` و`avatar_storage_key`
  بيتنضّفوا من الداتابيز فالملف بيبقى يتيم بلا مرجع. محتاج مهمة تنظيف دورية على التخزين.
- بيانات التواصل الرسمية (`NEXT_PUBLIC_SUPPORT_EMAIL` / `_PHONE` / `_LEGAL_ADDRESS`) لسه فاضية —
  الصفحات بتخفي القسم لما تكون فاضية، لكن Google Play **بيطلبها**، فلازم تتملى قبل أول رفع.
- مراجعة محامٍ مصري للنص النهائي (خصوصًا بند الضمان ومدد الاحتفاظ بالرقم القومي).

### P0-1 (المرجع الأصلي)

- الـAPI يحتوي `DELETE /auth/me`، لكن يجب توفير زر واضح داخل **تطبيق العميل وتطبيق الفني**.
- يجب توفير صفحة ويب عامة لحذف الحساب أو طلب حذفه، لأن Google Play يطلب مسارًا داخل التطبيق ورابطًا
  خارجيًا أيضًا.
- الحذف الحالي Soft Delete وتعطيل حساب. يجب حصر البيانات التي تُحذف، وما يُحتفظ به لسبب مالي أو
  قانوني، وذكر المدة والسبب في السياسة. Google لا يعتبر تعطيل الحساب وحده حذفًا كاملًا.
- نضيف سياسة الخصوصية وشروط الاستخدام داخل التطبيق وفي Store Listing.

### P0-2 — مفتاح Google Maps ظاهر داخل Git

يوجد حاليًا مفتاح Maps مثبت داخل Android وiOS وWeb في `apps/customer-app`. المطلوب قبل النشر:

1. تدوير المفاتيح الحالية من Google Cloud؛ لا نكتفي بإخفائها لأنها ظهرت بالفعل في تاريخ Git.
2. مفتاح منفصل لكل منصة.
3. تقييد مفتاح Android بالـpackage ID وبصمة توقيع Google Play، وتقييده بالـMaps SDK فقط.
4. تقييد Web بالدومينات المسموحة، وServer بعنوان IP أو Proxy مناسب.
5. نقل القيم إلى build secrets/Gradle secrets بدل النص الصريح داخل الملفات.
6. وضع Quotas وBudget Alerts لمنع فاتورة بسبب إساءة الاستخدام.

### P0-3 — إصدار Android وتوقيعه

- تثبيت الـpackage IDs النهائية قبل أول رفع؛ تغييرها لاحقًا يعني تطبيقًا جديدًا.
- إنشاء Upload Keystore حقيقي لكل تطبيق أو مفتاح واحد بسياسة واضحة، وتفعيل Play App Signing.
- حفظ الـkeystore وكلمات مروره في نسختين مشفرتين منفصلتين؛ لا يدخل Git أبدًا.
- البناء الحالي يرجع لتوقيع Debug إذا غاب `key.properties`. إصدار المتجر يجب أن **يفشل** بدل أن
  ينتج نسخة Debug بصمت.
- بناء ملفي `.aab` موقّعين، لا APK. زيادة `versionCode` في كل رفع.
- التأكد أن الناتج يستهدف Android 16 / API 36 طبقًا لمتطلب Google Play الحالي.

### P0-4 — صلاحية Full Screen في تطبيق الفني

`USE_FULL_SCREEN_INTENT` موجود لإشعارات الطوارئ. Google يقصر الاستخدام التلقائي أساسًا على تطبيقات
المكالمات والمنبهات؛ تطبيق الفني غالبًا لا يقع ضمنها. الأسلم قبل المراجعة:

- استبدالها بإشعار High Priority/Heads-up طبيعي يعمل على شاشة القفل، أو تقديم declaration مبرر
  والتعامل مع رفض الصلاحية بدون تعطيل التطبيق.
- حذف الصلاحية إن لم تكن ضرورة أساسية حتى لا تتسبب في رفض المتجر.

### P0-5 — الإشعارات الحقيقية

- وضع `google-services.json` الصحيح لكل تطبيق وعدم رفع Service Account إلى Git.
- ضبط `FIREBASE_SERVICE_ACCOUNT_JSON` في Secrets على السيرفر.
- اختبار: Foreground، Background، التطبيق مغلق، الشاشة مقفلة، فتح الإشعار للمكان الصحيح، تحديث
  FCM token، logout، ومستخدم لديه جهازان.
- اختبار الأحداث الحرجة: طلب جديد، قبول/رفض، تغيير موعد، عرض مشروع/عربون، تغيير طاقم، دفع، استرجاع،
  مطالبة ضمان وقبولها/رفضها، رسائل الشات، وتعطل/استعادة حساب.
- إشعارات الـDB وحدها لا تكفي؛ النجاح يعني ظهور Push على جهاز فعلي وفتح الشاشة الصحيحة.

### P0-6 — الأموال والدفع والاسترجاع

- الإطلاق الأول يستخدم Paymob فقط. يظل Fawry مغلقًا حتى نجاح Sandbox حقيقي والتحقق من ترتيب توقيعه
  حسب وثائق حساب التاجر الحالية.
- اختبار Paymob Test Mode ثم عملية Live صغيرة: Card + Mobile Wallet + Deposit + Remaining cash.
- اختبار webhook صحيح، webhook مكرر، webhook متأخر، توقيع خاطئ، timeout، ونجاح الدفع مع سقوط التطبيق.
- كل webhook يجب أن يكون idempotent: التكرار لا يضاعف رصيدًا ولا يكرر تسوية.
- اختبار Refund كامل وجزئي، ظهور الرصيد للعميل، Ledger الأدمن، Wallet العميل، ومستحقات الفني.
- عمل reconciliation يومي: إجمالي بوابة الدفع = سجلات payments = حركة المحافظ = حسابات الطلبات.
- لا تُخزن بيانات بطاقة في قاعدة بياناتنا؛ الدفع يتم داخل Paymob.

### P0-7 — قاعدة البيانات والنسخ الاحتياطي

- Production DB منفصلة نهائيًا عن Local وStaging.
- تطبيق `infra/migrations/migrate.js` كخطوة نشر قبل تشغيل الإصدار الجديد، مع نسخة احتياطية قبلها.
- النسخ المقترحة: 7 يومية + 4 أسبوعية + 6 شهرية، مشفرة ومخزنة في R2 منفصل.
- تشغيل `pg_dump` يوميًا، وفحص نجاح الملف وحجمه وإرسال Alert عند الفشل.
- استرجاع النسخة إلى Staging مرة كل شهر، ثم فحص عدد المستخدمين والطلبات والمدفوعات والمحافظ.
- الهدف الأول: `RPO ≤ 24h` للخطة الرخيصة. قبل الإطلاق العام والأموال الكثيفة نرفعه إلى PITR أقرب
  لـ5 دقائق وخطة مدفوعة لقاعدة البيانات.
- لا نقول "عندنا Backup" إلا بعد نجاح Restore فعلي موثق.

### P0-8 — التشغيل والمراقبة

- `GET /api/v1/health` موجود ويفحص اتصال قاعدة البيانات؛ Better Stack يراقبه كل دقيقة.
- نضيف مراقبة Redis والطوابير والتخزين، وليس HTTP فقط.
- Alert فوري عند: API down، 5xx مرتفعة، Queue متوقفة، فشل Backup، فشل Webhooks، أو زيادة تكلفة.
- تفعيل Firebase Crashlytics في التطبيقين وربط إصدار المتجر برقم النسخة.
- كتابة وتشغيل Runbooks لانقطاع DB، تعطل الدفع، تسرب بيانات، فشل نشر، وDDoS؛ الملفات الحالية مجرد
  قائمة فارغة وليست خطة استجابة مكتملة.
- كل نشر له Rollback واضح إلى آخر صورة مستقرة، مع منع rollback لقاعدة البيانات بدون خطة migration.

## 5. إعداد Production

### العناوين المقترحة

```text
https://api.YOUR_DOMAIN/api/v1
https://admin.YOUR_DOMAIN
https://www.YOUR_DOMAIN
https://www.YOUR_DOMAIN/privacy
https://www.YOUR_DOMAIN/terms
https://www.YOUR_DOMAIN/account-deletion
https://status.YOUR_DOMAIN
```

### Secrets الأساسية للـAPI

لا توضع أي قيمة حقيقية في Git. توضع في Secret Manager لدى Railway:

```text
NODE_ENV=production
PORT=3000
API_PREFIX=api/v1
DATABASE_URL=
REDIS_URL=
CORS_ORIGIN=https://admin.YOUR_DOMAIN,https://www.YOUR_DOMAIN
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
SETTINGS_ENCRYPTION_KEY=
PII_ENCRYPTION_KEY=
WEBAUTHN_RP_NAME=
WEBAUTHN_RP_ID=admin.YOUR_DOMAIN
WEBAUTHN_ORIGIN=https://admin.YOUR_DOMAIN
STORAGE_PROVIDER=s3
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
FIREBASE_SERVICE_ACCOUNT_JSON=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM_NUMBER=
PAYMOB_API_KEY=
PAYMOB_SECRET_KEY=
PAYMOB_PUBLIC_KEY=
PAYMOB_INTEGRATION_ID_CARD=
PAYMOB_INTEGRATION_ID_MOBILE_WALLET=
PAYMOB_HMAC_SECRET=
```

نستخدم أسرارًا عشوائية مختلفة لا تقل عن 32 حرفًا، ولا نغيّر مفاتيح التشفير بعد بدء تخزين البيانات
إلا بخطة تدوير؛ فقدانها قد يجعل البيانات المشفرة غير قابلة للقراءة.

## 6. خطة Google Play للتطبيقين

### إنشاء الحساب والقوائم

1. اختيار Full Distribution ودفع 25 دولارًا مرة واحدة.
2. لو النشاط التجاري رسمي: Organization + D-U-N-S + موقع موثق. لو الحساب Personal جديد بعد
   13 نوفمبر 2023، Google يطلب 12 مختبرًا على الأقل منضمين للاختبار المغلق 14 يومًا متصلة قبل
   طلب Production.
3. إنشاء App للعميل وApp للفني. لغة أساسية عربية، مصر كمنطقة الاختبار الأولى.
4. تفعيل Play App Signing ورفع AAB منفصل لكل تطبيق.

### ملفات المتجر لكل تطبيق

- اسم قصير، وصف قصير، وصف كامل، App icon، Feature graphic، ولقطات شاشة حقيقية.
- بريد ورقم دعم، رابط سياسة الخصوصية، رابط حذف الحساب، وتصنيف المحتوى.
- Data Safety دقيقة تشمل كل SDK: الهاتف، الموقع الدقيق/التقريبي، الصور، المستندات، الدردشة، الدفع،
  Crashlytics وAnalytics. التطبيق الفني يشمل بيانات الهوية والتحقق.
- Ads declaration: نحدد أنه لا توجد إعلانات إذا ظل التطبيق بلا SDK إعلاني.
- Target audience المناسب، وتوضيح أن التطبيق ليس موجهًا للأطفال.
- App access: حساب مراجعة أو خطوات OTP قابلة للمراجع؛ لا نترك Google عالقًا خلف تسجيل دخول.
- Permission declarations للموقع والإشعارات وأي صلاحية حساسة متبقية.

### مراحل النشر

#### المرحلة A — Internal Testing

- 3–5 أشخاص، أجهزة Android مختلفة وإصدارات مختلفة.
- مدة 2–3 أيام، ثم إصلاح أي Crash أو P0/P1.
- الاختبار لكل من تطبيق العميل والفني، لأن دورة الطلب تحتاج الاثنين.

#### المرحلة B — Closed Testing

- 15 شخصًا بدل الحد الأدنى 12 لتوفير هامش لو انسحب أحدهم.
- يظل 12 على الأقل Opted-in لمدة 14 يومًا متصلة إن كان الحساب Personal جديدًا.
- تقسيم عملي: 8 عملاء + 5 فنيين + 2 إدارة/دعم، مع إمكانية تبديل الأدوار.
- Feedback form يومي قصير + قناة دعم واحدة + تسجيل رقم الإصدار والجهاز مع كل مشكلة.

#### المرحلة C — Production staged rollout

- `5%` لمدة 24–48 ساعة، ثم `20%`، ثم `50%`، ثم `100%` فقط لو المؤشرات سليمة.
- نوقف rollout فورًا عند خطأ أموال، تسريب بيانات، تعطل login، crash متكرر، أو توقف إشعارات الطلبات.
- نستخدم Managed Publishing حتى لا ينزل الإصدار تلقائيًا في وقت غير مراقب.

## 7. سيناريو الاختبار المغلق

### دورة العميل والفني

1. عميل جديد يسجل OTP، يسمح ويرفض الموقع والإشعارات في تجربتين منفصلتين.
2. ينشئ طلبًا نقديًا وطلب Deposit وطلبًا مدفوعًا بالكامل أونلاين.
3. Auto-matching يعرض الطلب على فني صحيح وشركة صحيحة للمشاريع الكبيرة.
4. فني يقبل، يضيف مساعدًا عند السماح، ويظهر تعارض الجدول إن وجد.
5. العميل والأدمن والفني يرون الموعد نفسه، وكل تغيير يرسل Notification للطرفين.
6. صور قبل/بعد، chat، location، وصول، بدء، إنهاء، كاش، وتسوية المستحقات.
7. طلب إلغاء قبل وبعد الحالات الحرجة، مع السبب والرسوم الصحيحة.
8. Warranty claim ثم قبول/رفض الأدمن وإشعار العميل.
9. Refund كامل وجزئي وظهور الرصيد واستخدامه في طلب تالٍ.
10. حذف حساب العميل والفني والتأكد أن التوكن والجلسات لم تعد تعمل.

### اختبارات الفشل

- فصل الإنترنت أثناء الحجز والدفع ثم إعادة المحاولة بدون إنشاء طلبين.
- إغلاق التطبيق أثناء الدفع وعودة webhook لاحقًا.
- ضغط زر الدفع/القبول/تحصيل الكاش مرتين بسرعة.
- إعادة إرسال webhook نفسه 3 مرات.
- توقف Redis مؤقتًا ثم عودته دون فقد دائم للطلبات.
- صورة كبيرة أو نوع ملف غير مسموح.
- مستخدم بلا موقع، بلا Push permission، أو FCM token قديم.
- إعادة تشغيل API أثناء وجود طلبات نشطة.
- استرجاع Backup كامل إلى Staging.

## 8. معايير Go / No-Go

لا نطلب Production من Google إلا عند تحقق كل الآتي:

- صفر مشكلة `P0` وصفر مشكلة `P1` مفتوحة.
- CI أخضر للـAPI والأدمن والتطبيقين، مع إضافة Customer Web وRelease AAB للـCI.
- نجاح Build موقّع للتطبيقين وفحصه عبر Play Internal App Sharing/Testing.
- 99.5% على الأقل Crash-free sessions أثناء الاختبار المغلق.
- لا توجد أي حالة دفع أو Refund غير متطابقة في reconciliation.
- وصول 100% من إشعارات السيناريوهات الحرجة في عينة الاختبار، أو وجود fallback واضح موثق.
- نجاح Restore من Backup خلال الزمن المتفق عليه.
- `/health` مستقر، ولا توجد قفزات 5xx أو Queue failures غير معالجة.
- Privacy / Terms / Account deletion URLs منشورة ومطابقة للسلوك الفعلي.
- فريق الدعم يعرف خطوات التعامل مع الدفع المعلق، Refund، الضمان، وتوقف الخدمة.

## 9. جدول تنفيذ واقعي

### الأسبوع 1 — الحسابات والأمان

- دومين، Play Console، D-U-N-S إن لزم، Firebase، Hosting، DB، Redis، R2، Monitoring.
- تدوير Maps keys وإغلاق صلاحية Full Screen غير المناسبة.
- إضافة حذف الحساب والسياسات وصفحاتها.
- تجهيز مفاتيح توقيع Android وpackage IDs النهائية.

### الأسبوع 2 — Production/Staging

- نشر Staging ثم Production، تطبيق migrations، ضبط Secrets، DNS وTLS.
- تفعيل FCM وTwilio وPaymob Test، إعداد Backup وAlerts.
- إضافة Customer Web وRelease AAB والـsecurity checks إلى CI.
- كتابة Runbooks وتجربة Rollback وRestore.

### الأسبوع 3 — Internal Testing

- رفع التطبيقين، 3–5 مختبرين، إصلاح أعطال الأجهزة والصلاحيات والإشعارات.
- عملية Paymob Live صغيرة ثم Refund تحت مراقبة الأدمن.

### الأسبوعان 4 و5 — Closed Testing

- 15 مختبرًا لمدة 14 يومًا، سيناريوهات كاملة، قياس crashes والتكلفة والـwebhooks.
- إصلاحات بإصدارات متدرجة مع زيادة build number.

### الأسبوع 6 — Production

- إرسال طلب Production، ثم staged rollout ومراقبة يومية أول أسبوعين.

المدة قد تزيد بسبب اعتماد حساب التاجر أو D-U-N-S أو مراجعة Google؛ لذلك نبدأ هذه الحسابات أولًا
بالتوازي مع إغلاق بنود الكود.

## 10. قرار الخدمات عند التوسع

نرفع الخطة المدفوعة عندما يحدث أول واحد من الآتي:

- قاعدة البيانات تتجاوز 70% من حدها أو نحتاج PITR أطول وHA/SLA.
- Redis يتجاوز 70% من الأوامر/الذاكرة أو تظهر Queue latency.
- Railway يقترب من حد التكلفة الموضوع أو يحتاج أكثر من instance.
- R2 يقترب من حدود العمليات المجانية أو زاد حجم المستندات.
- عدد المستخدمين النشطين أو الطلبات يجعل downtime ساعة واحدة خسارة فعلية.

لا ننتظر انقطاع الخدمة حتى نرفع الخطة؛ نضع تنبيه عند 50% و70% و90% لكل quota.

## 11. المراجع الرسمية الحالية

- [Google Play — Internal/Closed/Open testing](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en)
- [Google Play — متطلب 12 مختبرًا/14 يومًا للحسابات الشخصية الجديدة](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)
- [Google Play — إنشاء الحساب ورسوم 25 دولارًا](https://support.google.com/android-developer-console/answer/16604405?hl=en)
- [Google Play — Personal أم Organization وD-U-N-S](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en)
- [Google Play — Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Google Play — Android App Bundle](https://support.google.com/googleplay/android-developer/answer/9844279?hl=en-EN)
- [Google Play — User data وAccount deletion](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
- [Google Play — Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
- [Google Play — Full-screen intent policy](https://support.google.com/googleplay/android-developer/answer/16965181?hl=en)
- [Firebase pricing](https://firebase.google.com/pricing)
- [Neon pricing](https://neon.com/pricing)
- [Upstash Redis pricing](https://upstash.com/pricing/redis)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Railway plans](https://docs.railway.com/pricing/plans)
- [Better Stack pricing](https://betterstack.com/pricing)
- [Twilio trial limitations](https://www.twilio.com/docs/usage/trials)
- [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Maps API security](https://developers.google.com/maps/api-security-best-practices)

## 12. أول ثلاث خطوات من الآن

1. فتح/تأكيد حساب Google Play Full Distribution وتحديد هل المالك Personal أم Organization.
2. شراء الدومين وفتح Paymob Merchant وD-U-N-S بالتوازي لأنهم الأطول انتظارًا.
3. فتح مهمة تقنية مستقلة بعنوان **Production P0 hardening** لإغلاق البنود الثمانية في §4، ثم لا
   نرفع أي AAB للـClosed Test قبل مراجعة Go/No-Go في §8.
