# 31 — قائمة تحقّق متغيّرات بيئة الإنتاج (Osta)

**التاريخ**: 2026-09-10 · بند §12/§13 من مواصفة إعداد الإنتاج.

> 🔒 **الملف ده مافيهوش ولا قيمة سرّية واحدة، وممنوع يتحط فيه أي قيمة.** ده جدول **أسماء** ومصادر
> بس. القيم الحقيقية مكانها الوحيد: متغيّرات بيئة على سيرفر الإنتاج (أو خزنة أسرار المنصة) —
> مش ملف في git، مش لقطة شاشة، مش رسالة.

`NODE_ENV=staging` **و**`production` الاتنين بيتعاملوا بنفس الصرامة (النشر الفعلي على staging
بيخدم مستخدمين حقيقيين — راجع التعليق في `apps/api/src/config/env.validation.ts`).

---

## ١. بيسقّط الإقلاع لو ناقص (fail-fast — مقصود)

| المتغيّر | القيد في staging/production |
|---|---|
| `DATABASE_URL` | مطلوب دايمًا |
| `JWT_ACCESS_SECRET` | ≥32 حرف، وممنوع القيمة الافتراضية من `.env.example` |
| `JWT_REFRESH_SECRET` | ≥32 حرف، **ولازم يختلف عن** `JWT_ACCESS_SECRET` |
| `SETTINGS_ENCRYPTION_KEY` | مطلوب، ≥32، وممنوع الافتراضية. **مايتغيّرش بعد التشغيل** — بيبطّل فك كل الأسرار المخزّنة |
| `CORS_ORIGIN` | مطلوب وغير فاضي — الفاضي معناه `*` |
| `WEBAUTHN_RP_ID` | مطلوب، وممنوع `localhost` → `admin.ostahome.com` |
| `WEBAUTHN_ORIGIN` | مطلوب، وممنوع `http://localhost:3001` → `https://admin.ostahome.com` |
| `STORAGE_PROVIDER` | لازم `s3` (الـ`local` مرفوض — ملف بيتمسح مع كل نشر) |
| `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | مطلوبين مع `STORAGE_PROVIDER=s3` (حارس 2026-09-10) |
| بوابة الـSMS للمزوّد المختار | `SMS_PROVIDER=cequens` → `CEQUENS_SENDER_NAME` + (`CEQUENS_API_KEY` **أو** الأربعة `CEQUENS_CLIENT_ID/CLIENT_SECRET/USERNAME/PASSWORD`). `SMS_PROVIDER=twilio` → `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_SMS_FROM_NUMBER` |

كل واحد فيهم لو ناقص، السيرفر **يرفض يقلع** برسالة بتقول الناقص بالاسم. ده متعمّد: البديل هو
سيرفر بيقول "healthy" وهو مش قادر يبعت كود تحقق ولا يخزّن صورة.

## ٢. مطلوبة للإطلاق لكن مش بتوقف الإقلاع

| المتغيّر | لو ناقص |
|---|---|
| `PII_ENCRYPTION_KEY` | بيرجع لـ`SETTINGS_ENCRYPTION_KEY`. لو اتحدد لازم ≥32 وغير الافتراضية. **مايتغيّرش بعد التشغيل** — بيبطّل فك الأرقام القومية وهاشات التفرّد |
| `S3_ENDPOINT` / `S3_REGION` / `S3_FORCE_PATH_STYLE` | لـR2 لازم `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` + `auto` + `true` (`us-east-1` الافتراضي غلط لـR2) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | قناة push بترجع log-only — كل إشعار فوري بيختفي بصمت |
| `REDIS_URL` | الكاش/الطوابير بترجع للقاعدة؛ شغّال بس أبطأ وبلا جدولة موثوقة |
| `SMTP_*` | الإيميل log-only |
| `TWILIO_WHATSAPP_FROM_NUMBER` | قناة واتساب log-only (Twilio هو المزوّد الوحيد ليها) |

## ٣. اختيارية بالكامل — معطّلة بأمان لو ناقصة

| المتغيّر | السلوك من غيرها |
|---|---|
| `PAYMOB_*` (٦ قيم) | الدفع بالبطاقة/المحفظة بيرفض بوضوح (`PAY_001`). الكاش والمحفظة وInstaPay شغالين عادي. **مش مطلوبة للإطلاق** |
| `FAWRY_*` | نفس المنطق |
| `CEQUENS_BASE_URL` / `CEQUENS_AUTH_URL` | بيرجعوا للافتراضي الرسمي |
| `STORAGE_S3_URL_EXPIRY_SECONDS` | ٧ أيام (الحد الأقصى لـSigV4) |

**InstaPay مش env var خالص** — إعداد أدمن ديناميكي من `apps/admin` → الإعدادات (`super_admin`
بس)، والتأكيد يدوي بموظف Finance. مفيش أي تكامل API مع InstaPay وما ينفعش يتخلق واحد.

---

## ٤. النطاقات (§13)

| الاستخدام | النطاق |
|---|---|
| موقع العميل | `ostahome.com` |
| الـAPI | `api.ostahome.com` |
| لوحة الأدمن | `admin.ostahome.com` |

`CORS_ORIGIN` المفروض يبقى `https://ostahome.com,https://admin.ostahome.com` (بلا مسافات، مفصول
بفاصلة). أي مثال قديم بـ`baytak.com` اتشال من `.env.example` والتعليقات والاختبارات.

---

## ٥. قبل أول نشر — تحقّق يدوي

1. `git status` نضيف من أي ملف سر (راجع §٦ تحت).
2. السيرفر بيقلع فعلاً بـ`NODE_ENV=production` — لو وقع، الرسالة بتقول الناقص بالاسم.
3. إرسال SMS تجريبي حقيقي واحد عبر CEQUENS (تأكيد أي مسار مصادقة مفعّل على الحساب).
4. رفع صورة حقيقية وفتح الرابط الراجع — بيأكّد R2 وpresigned URLs.
5. تسجيل دخول أدمن بـWebAuthn — بيأكّد `WEBAUTHN_RP_ID`/`ORIGIN`.

## ٦. ملفات ممنوع تدخل git نهائيًا

`*.env` · `*.jks` · `*.keystore` · `android/key.properties` · `android/maps.properties` ·
`android/app/google-services.json` · `ios/Runner/GoogleService-Info.plist` · أي
`service-account*.json`.

كلهم مغطّيين بـ`.gitignore` حاليًا. للتأكد في أي وقت:

```bash
git ls-files | grep -iE '\.jks$|\.keystore$|key\.properties$|maps\.properties$|google-services\.json$|service-account|\.env$'
```

المخرَج المتوقّع: **فاضي**. أي سطر هنا = سر متتبّع في git ولازم يتشال ويتدوّر (rotate) فورًا،
لأن مسح الملف لوحده مابيمسحوش من تاريخ git.

---

## ٧. تدقيق أمان الأسرار — نتيجة 2026-09-10 (§15)

**الشجرة الحالية نضيفة**:

- صفر ملفات سرّية متتبّعة في git (الأمر في §٦ رجع فاضي).
- كل ملفات الأسرار المحلية مغطّاة بـ`.gitignore` واتأكّد كل واحد فيهم بـ`git check-ignore`.
- مسح على كل الملفات المتتبّعة بأنماط الأسرار المعروفة (مفاتيح Google، `sk_live_`، `AKIA…`،
  مفاتيح خاصة PEM، توكنات Slack/GitHub): **صفر نتائج حقيقية** — الظهور الوحيد هو أنماط الكشف
  نفسها جوّه `scripts/security-audit.js`.
- صفر أسرار في كود Flutter أو أي واجهة أمامية. مفاتيح الخرائط بتتقرا وقت البناء من
  `maps.properties` (غير متتبّع)، ومفتاح خدمة Firebase سيرفر بس.

**⚠️ انكشاف تاريخي — مطلوب تدوير (rotation)**:

| النوع | المكان | الحالة |
|---|---|---|
| مفتاح Google Maps API (أندرويد/iOS) | تاريخ git — أُضيف في `6808d41c`، وأُعيد في `7539bae1`، واتشال من الشجرة في `29fea234` | **مكشوف بشكل دائم** |
| مفتاح Google Maps API (ويب) | تاريخ git — `7539bae1` | **مكشوف بشكل دائم** |

مسح الملف بيشيل السر من الشجرة **مش من التاريخ**؛ أي حد عنده نسخة من الريبو (أو أي fork) يقدر
يقراه. القيم نفسها **مش مكتوبة هنا عمدًا**.

**المطلوب قبل الإطلاق**:

1. **دوّر المفتاحين** من Google Cloud Console (احذف القديم واعمل جديد) — التدوير هو العلاج
   الوحيد الفعّال، إعادة كتابة تاريخ git مش كافية ومكلفة.
2. على المفتاح الجديد للأندرويد: قيّده بـ **Android apps** بحزمة `com.ostahome.customer` +
   بصمة SHA-1 بتاعة **مفتاح Google Play للتوقيع** (مش مفتاح الرفع — راجع `maps.properties.example`).
3. قيّد كل مفتاح على الـAPI المطلوب بس (`Maps SDK for Android` / `Maps JavaScript API`).
4. راقب استخدام المفتاح القديم يوم/يومين بعد التدوير عشان تلاقط أي تكامل ناسي.
