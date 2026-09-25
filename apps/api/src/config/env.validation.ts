import * as Joi from 'joi';
// مصدر واحد لأسماء المزوّدات — الـJoi هنا واللي بيختار وقت التركيب بيقروا نفس القايمة.
import { SMS_PROVIDERS } from '../common/notifications/sms-dispatcher';

// Script 2 Part M (finding #63، اتكشفت أثناء مراجعة Part G) — بَقّة أمنية حقيقية وخطيرة: كل
// فحوصات fail-fast تحت دي كانت بتتفحص ضد 'production' بس. النشر الفعلي الحقيقي (Railway) شغال
// بـNODE_ENV=staging (مش production) — قرار تشغيلي سابق مش له علاقة بصلاحية البيانات/الأسرار
// (كلها حقيقية ومُفعّلة). ده معناه كل الحمايات دي كانت متخطّاة فعليًا على البيئة الحقيقية اللي
// بيستخدمها مستخدمين حقيقيين: أخطرهم كود OTP الخام بيتسجل في اللوج بوضوح (auth.service.ts) —
// أي حد عنده access للوجز يقدر ياخد كود أي مستخدم حقيقي ويدخل حسابه. 'staging' هنا مش بيئة QA
// معزولة ببيانات وهمية، دي نفس البنية اللي بتخدم مستخدمين حقيقيين، فلازم تتعامل بنفس صرامة
// 'production' في كل فحوصات الأمان دي.
const PRODUCTION_LIKE_ENV = Joi.valid('staging', 'production');
export const isProductionLikeEnv = (nodeEnv: string | undefined): boolean => nodeEnv === 'staging' || nodeEnv === 'production';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  DATABASE_URL: Joi.string().uri().required(),

  // في staging/production بس: طول أدنى أعلى (32 بدل 16) ورفض صريح للقيم الافتراضية الموجودة في
  // .env.example — عشان لو حد نسي يستبدلها وقت النشر الحقيقي، السيرفر يرفض يشتغل من الأول
  // (fail-fast) بدل ما يشتغل بسر ضعيف/معروف مسبقاً. في التطوير/الاختبار القيم الافتراضية من
  // .env.example لسه شغالة عادي (نفس دليل التشغيل المحلي في README.md الرئيسي).
  JWT_ACCESS_SECRET: Joi.string()
    .min(16)
    .required()
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().min(32).invalid('change-me-access-secret') }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string()
    .min(16)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET')) // نفس السر لـaccess وrefresh يلغي فائدة فصلهم بالكامل
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().min(32).invalid('change-me-refresh-secret') }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  AUTH_PIN_PEPPER: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', {
      is: PRODUCTION_LIKE_ENV,
      then: Joi.string().min(32).required().invalid('change-me-pin-pepper'),
    }),
  SETTINGS_ENCRYPTION_KEY: Joi.string()
    .min(32)
    .allow('')
    .optional()
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().min(32).invalid('change-me-settings-encryption-key').required() }),

  // مفتاح تشفير بيانات الهوية (ADR-0045). مش مطلوب صراحةً في الإنتاج لأن الكود بيرجع لـ
  // SETTINGS_ENCRYPTION_KEY المطلوب فوق — بس لو اتحدد لازم يكون قوي، والقيمة الافتراضية مرفوضة.
  PII_ENCRYPTION_KEY: Joi.string()
    .min(32)
    .allow('')
    .optional()
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().min(32).invalid('change-me-pii-encryption-key-32ch') }),

  // قائمة أصول (origins) مسموح لها بنداء الـAPI من متصفح، مفصولة بفاصلة — راجع الشرح الكامل في
  // main.ts. فاضي/غير موجود = مفتوح للكل (`*`)، مقبول في التطوير بس مرفوض صراحة في staging/production.
  CORS_ORIGIN: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().min(1).required() }),

  /**
   * **وجهة الملصق المطبوع لما مفيش متجر** (تدقيق شامل 2026-09-20).
   *
   * `resolveSmartLinkTarget()` بيقرا الترتيب: متجر المنصة ⇐ `marketing.web_landing_url` ⇐
   * المتغيّر ده ⇐ `/`. المتغيّر ده كان **بيتقرا من `process.env` مباشرةً وبس** — مش معرّف في
   * `.env.example` ولا في `configuration.ts` ولا هنا، فمحدش كان يعرف إنه مطلوب أصلاً.
   *
   * النتيجة اللي اتقاست حيًّا: `marketing.ios_store_url` و`marketing.web_landing_url` فاضيين
   * في القاعدة، فمستخدم آيفون أو كمبيوتر بيمسح **أي** QR من المنصة (ترشيح فني `/t`، كود خصم
   * `/p`، حملة `/r`) كان بيروح على `/` على دومين الـAPI نفسه — صفحة ميتة. أندرويد لوحده هو
   * اللي كان شغّال لأن متجره هو المظبوط.
   *
   * الملصق المطبوع عايش شهور بعد ما يتطبع، فده مش إعداد تجميلي: بنطلبه صراحةً في الإنتاج بدل
   * ما نستنى حد يبلّغ إن الـQR مش شغّال.
   */
  CUSTOMER_WEB_URL: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', {
      is: PRODUCTION_LIKE_ENV,
      then: Joi.string().uri().invalid('http://localhost:3002').required(),
    }),

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),

  // ── وضع اختبار الـOTP (تطوير محلي بس، docs/08 §173) ─────────────────────────────
  // **مرفوض تمامًا في staging/production** بالحارس تحت. الشرح الكامل في
  // `modules/auth/otp-test-mode.ts` — الوضع بيغيّر **الكود المولَّد** وبيوقف إرسال SMS، ومسار
  // التحقق مافيهوش ولا فرع ليه، فكل حمايات الـOTP بتفضل سارية زي ما هي.
  OTP_TEST_MODE: Joi.boolean().default(false),
  // ٦ أرقام زي الكود الحقيقي — أي طول تاني بيخلي شاشة الإدخال في التطبيق مستحيل تتملى.
  OTP_TEST_MODE_CODE: Joi.string().length(6).pattern(/^[0-9]{6}$/).default('111111'),
  // أرقام المختبرين مفصولة بفواصل. فاضية = أي رقم (ينفع بس لو قاعدة الاختبار منفصلة).
  OTP_TEST_MODE_PHONES: Joi.string().allow('').optional(),

  // WebAuthn/Passkeys لدخول الأدمن (ADR-0011) — قيم localhost الافتراضية شغالة في التطوير بس،
  // مرفوضة صراحة في الإنتاج (نفس فلسفة JWT secrets فوق) — لو نسيت تظبطهم، السيرفر يرفض يشتغل
  // بدل ما WebAuthn يترفض بصمت من كل متصفح حقيقي.
  // بَقّة حقيقية اتلقطت واتصلحت هنا (docs/08 §19 بند 16): `.when(...then: Joi.string().invalid(...))`
  // من غير `.required()` صريحة في الـthen بتفشل تمنع القيمة الافتراضية (`.default()`) — Joi
  // بيملأ الافتراضي مباشرة لمفتاح غايب بلا ما يعيد فحصه ضد قيود الـthen. يعني لو المتغيّر ده
  // اتسيب فاضي تمامًا (مش متسجّل خالص، مش بس ='localhost' صراحة) في الإنتاج، السيرفر كان بيقلع
  // "healthy" بـWebAuthn شغال بقيم localhost حقيقية — نفس فئة البَقّة اللي بند 16 بيعالجها
  // لـSTORAGE_PROVIDER/Twilio. `.required()` في الـthen بيغلق الفجوة.
  WEBAUTHN_RP_NAME: Joi.string().default('أسطى — لوحة التحكم'),
  WEBAUTHN_RP_ID: Joi.string()
    .default('localhost')
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().invalid('localhost').required() }),
  WEBAUTHN_ORIGIN: Joi.string()
    .uri()
    .default('http://localhost:3001')
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().uri().invalid('http://localhost:3001').required() }),

  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),

  // بوابة الدفع بالبطاقة (Paymob) — اختيارية عمداً، الكاش والمحفظة بيشتغلوا من غيرها.
  // تفاصيل الحصول على كل قيمة: docs/03-external-integrations.md
  // `.allow('')` — بَقّة حقيقية اتلقطت واتصلحت (2026-08-11): .env.example نفسه بيسيب القيم دي
  // فاضية (`KEY=`) وبيقول "انسخه لـ.env محلياً"، لكن Joi.string().optional() لوحدها بترفض قيمة
  // فاضية موجودة (`''`) — مختلف عن القيمة غير الموجودة خالص. نسخ .env.example زي ما هو كان
  // بيكسر تشغيل السيرفر بالكامل (Config validation error) بدل ما "يرجع log-only" زي الموثّق.
  PAYMOB_BASE_URL: Joi.string().uri().default('https://accept.paymob.com'),
  // API_KEY لسه لازم لـTransaction Inquiry القديم (auth_token عبر /api/auth/tokens) — Paymob
  // مبدّلش مصادقة الـendpoint ده لـIntention API لسه (ADR-0013). SECRET_KEY/PUBLIC_KEY جداد —
  // Intention API (Token auth) وUnified Checkout بالترتيب.
  PAYMOB_API_KEY: Joi.string().allow('').optional(),
  PAYMOB_SECRET_KEY: Joi.string().allow('').optional(),
  PAYMOB_PUBLIC_KEY: Joi.string().allow('').optional(),
  PAYMOB_INTEGRATION_ID_CARD: Joi.string().allow('').optional(),
  // docs/08 §19 بند 15 — Mobile Wallet (Vodafone Cash/إلخ) عبر نفس حساب Paymob، اختياري بالكامل.
  PAYMOB_INTEGRATION_ID_MOBILE_WALLET: Joi.string().allow('').optional(),
  PAYMOB_IFRAME_ID: Joi.string().allow('').optional(),
  PAYMOB_HMAC_SECRET: Joi.string().allow('').optional(),

  // بوابة تانية جنب Paymob (كود مرجعي "ادفع في أقرب فوري") — اختيارية بالكامل برضه.
  // تفاصيل الحصول على كل قيمة، وتحذير مهم عن التحقق من توقيع HMAC قبل الإنتاج: docs/03-external-integrations.md
  FAWRY_BASE_URL: Joi.string().uri().default('https://atfawry.fawrystaging.com'),
  FAWRY_MERCHANT_CODE: Joi.string().allow('').optional(),
  FAWRY_SECURE_KEY: Joi.string().allow('').optional(),
  FAWRY_REFERENCE_EXPIRY_HOURS: Joi.number().default(72),

  // InstaPay: عنوان IPA/اسم المستلم بقوا إعدادات أدمن (/admin/settings) مش env vars — §31.

  // تخزين الملفات — 'local' افتراضي (تطوير)، 'S3' للإنتاج. تفاصيل كل قيمة: docs/03-external-integrations.md
  // docs/08 §19 بند 16 — كان النظام يقدر يقلع "healthy" في الإنتاج وهو لسه بيكتب على قرص محلي
  // (بيتمسح مع كل إعادة نشر/deploy جديد، ومش متاح لأكتر من instance واحدة خلف load balancer).
  // مرفوض صراحة في staging/production — نفس فلسفة JWT/CORS/WebAuthn فوق (fail-fast).
  STORAGE_PROVIDER: Joi.string()
    .valid('local', 's3')
    .default('local')
    .when('NODE_ENV', { is: PRODUCTION_LIKE_ENV, then: Joi.string().invalid('local').required() }),
  STORAGE_LOCAL_DIR: Joi.string().default('./uploads'),
  // بَقّة حقيقية (2026-08-23): LocalDiskStorageService.getUrl() كان بيرجّع مسار نسبي بس (`/uploads/...`
  // من غير scheme/host) — شغال بس لما الـconsumer على نفس أصل الـAPI بالظبط. أي frontend على أصل
  // تاني (apps/admin على 3001، apps/customer-web، تطبيقات Flutter) كان بيحل المسار ضد أصل نفسه هو
  // مش أصل الـAPI → صورة معطوبة تمامًا (404/307 حسب توجيه الـfrontend نفسه). لازم رابط مطلق كامل
  // زي S3 presigned URLs بالظبط. افتراضي `http://localhost:<PORT>` يشتغل بدون أي إعداد لبيئة التطوير.
  STORAGE_LOCAL_PUBLIC_BASE_URL: Joi.string().uri().allow('').optional(),
  S3_ENDPOINT: Joi.string().uri().allow('').optional(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  STORAGE_S3_URL_EXPIRY_SECONDS: Joi.number().default(60 * 60 * 24 * 7),

  // قنوات الإشعارات الخارجية — كل واحدة اختيارية بالكامل ومستقلة عن الباقي (قناة مش مُعدّة
  // بترجع log-only، مش بتفشّل). تفاصيل كل قيمة: docs/03-external-integrations.md
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().allow('').optional(),
  // مزوّد الـSMS الفعّال — CEQUENS هو الافتراضي (المزوّد المعتمد لمصر)، وTwilio بديل احتياطي.
  SMS_PROVIDER: Joi.string().valid(...SMS_PROVIDERS).default('cequens'),
  CEQUENS_API_KEY: Joi.string().allow('').optional(),
  CEQUENS_CLIENT_ID: Joi.string().allow('').optional(),
  CEQUENS_CLIENT_SECRET: Joi.string().allow('').optional(),
  CEQUENS_USERNAME: Joi.string().allow('').optional(),
  CEQUENS_PASSWORD: Joi.string().allow('').optional(),
  // **حد طول Sender ID مش تفصيلة شكلية**: المعيار (GSM 03.38 / TP-OA) بيحدّ اسم المُرسِل
  // الأبجدي بـ**١١ محرف**، والرقمي بـ**١٥ رقم**. قيمة أطول من كده المزوّد بيرفضها **وقت
  // الإرسال** — يعني السيرفر بيقلع "سليم" وكل كود تحقق بيفشل بهدوء، وبوابة الـSMS هي القناة
  // الوحيدة لتسليم الـOTP. الفحص هنا بيحوّل العطل ده من وقت التشغيل لوقت الإقلاع.
  CEQUENS_SENDER_NAME: Joi.string()
    .allow('')
    .optional()
    .custom((value: string, helpers) => {
      if (!value) return value;
      const isNumeric = /^\d+$/.test(value);
      const limit = isNumeric ? 15 : 11;
      if (value.length > limit) {
        return helpers.message({
          custom: `CEQUENS_SENDER_NAME طوله ${value.length} محرف — الحد ${limit} لاسم ${isNumeric ? 'رقمي' : 'أبجدي'} (معيار GSM). المزوّد هيرفض كل رسالة، وده معناه صفر تسجيل دخول.`,
        });
      }
      return value;
    }),
  // شكل رقم المستلم اللي بيتبعت لـCEQUENS — راجع الشرح الكامل في `cequens-sms-dispatcher.service.ts`.
  CEQUENS_RECIPIENT_FORMAT: Joi.string().valid('msisdn', 'e164').default('msisdn'),
  CEQUENS_BASE_URL: Joi.string().uri().allow('').optional(),
  CEQUENS_AUTH_URL: Joi.string().uri().allow('').optional(),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_SMS_FROM_NUMBER: Joi.string().allow('').optional(),
  TWILIO_WHATSAPP_FROM_NUMBER: Joi.string().allow('').optional(),
  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional(),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASSWORD: Joi.string().allow('').optional(),
  SMTP_FROM_EMAIL: Joi.string().allow('').optional(),
})
  // docs/08 §19 بند 16 — بوابة SMS هي القناة الوحيدة لتسليم كود OTP في الكود الحالي
  // (auth.service.ts، صفر بديل — لا WhatsApp ولا إيميل للـOTP). لو مش مُعدّة، السيرفر كان بيقلع
  // "healthy" في الإنتاج والـOTP endpoints بترجع 200 بلا ما أي رقم حقيقي يستلم كود خالص — مفيش
  // طريقة تانية لأي مستخدم حقيقي يسجّل دخول أو يعمل حساب.
  //
  // الحارس **بيتبع المزوّد المختار** (هجرة 2026-09-10 لـCEQUENS): قبل كده كان بيفرض بيانات
  // Twilio دايمًا، فإطلاق بـCEQUENS كان هيتقفل على مزوّد إحنا مابنستخدمهوش. فحص عابر للحقول
  // (مش `.when()` عادي) لأن كل مزوّد بياخد **مجموعة** حقول لازم تيجي مع بعض.
  // نفس فلسفة حارس الـSMS تحت، لكن للتخزين: `STORAGE_PROVIDER=s3` كان مفروض في الإنتاج من غير ما
  // حد يفرض **بيانات الـbucket نفسها**. النتيجة كانت سيرفر بيقلع "healthy" وS3Client متبني بـ
  // `bucket=undefined` وبيانات اعتماد فاضية — كل رفع ملف حقيقي (صور طلب، مستندات فني) بيفشل وقت
  // التشغيل بدل ما يتمنع وقت الإقلاع. إنتاج Osta على Cloudflare R2 (bucket: osta-production).
  .custom((value: Record<string, unknown>, helpers) => {
    if (isProductionLikeEnv(value.NODE_ENV as string | undefined) && value.STORAGE_PROVIDER === 's3') {
      const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((key) => !value[key]);
      if (missing.length > 0) {
        return helpers.message({
          custom: `STORAGE_PROVIDER=s3 يستلزم ${missing.join('/')} في staging/production — من غيرهم كل رفع ملف حقيقي بيفشل وقت التشغيل بدل ما يتمنع وقت الإقلاع`,
        });
      }
    }
    return value;
  })
  /**
   * **بوابة الـSMS: غيابها الكامل مسموح، وتجهيزها الناقص لأ** (ADR-0109).
   *
   * ### الشرط القديم مات مع الـOTP
   *
   * الحارس القديم كان بيمنع الإقلاع في الإنتاج لو مزوّد الـSMS مش مُجهّز، وحجته مكتوبة في
   * رسالته: «بوابة SMS هي القناة الوحيدة لتسليم كود OTP، من غيرها مفيش مستخدم حقيقي يقدر يسجّل
   * دخول». الحجة دي **مابقيتش صحيحة**: الدخول بقى برقم + رمز (ADR-0109) ومفيش أي SMS في مساره.
   *
   * وإبقاؤه كان هيبقى أسوأ من عدم اللزوم: كان **هيمنع إقلاع الإنتاج** على منصة قرّرت عن قصد
   * إنها ماتعتمدش على مزوّد SMS — وده بالظبط الهدف اللي ADR-0109 اتعمل عشانه.
   *
   * ### والفرق اللي الحارس الجديد بيحرسه
   *
   * الـSMS بقى **قناة إشعارات اختيارية**، و`CompositeNotificationDispatcher` بيرجّعها لـ
   * `LogOnlyNotificationDispatcher` لو مش مُجهّزة — تدهور رشيق مقصود.
   *
   * بس فيه فرق جوهري بين حالتين الحارس ده بيميّز بينهم:
   *
   * - **غياب كامل** ⇒ قرار واعٍ بعدم استخدام SMS. مسموح، والقناة تبقى log-only.
   * - **تجهيز ناقص** (مثلاً `CEQUENS_API_KEY` موجود و`CEQUENS_SENDER_NAME` ناقص) ⇒ **غلطة**،
   *   محدش بيقصدها. والنتيجة أسوأ من الغياب: الإعداد **يبان** مظبوط في اللوحة، والرسايل بتروح
   *   للوج بصمت. الحارس بيحوّل الغلطة دي لفشل إقلاع صوته عالي.
   */
  .custom((value: Record<string, unknown>, helpers) => {
    if (!isProductionLikeEnv(value.NODE_ENV as string | undefined)) return value;
    const provider = (value.SMS_PROVIDER as string | undefined) ?? 'cequens';

    if (provider === 'twilio') {
      const parts = [value.TWILIO_ACCOUNT_SID, value.TWILIO_AUTH_TOKEN, value.TWILIO_SMS_FROM_NUMBER];
      const present = parts.filter(Boolean).length;
      if (present > 0 && present < parts.length) {
        return helpers.message({
          custom:
            'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM_NUMBER مجهّزين نصّ تجهيز — سيبهم كلهم فاضيين (قناة SMS تبقى log-only) أو املاهم كلهم. التجهيز الناقص بيخلي الرسايل تروح للوج وإنت فاكرها اتبعتت',
        });
      }
      return value;
    }

    // CEQUENS بيقبل مسارين للمصادقة: مفتاح API جاهز، أو تبادل OAuth2 بالأربع قيم.
    const hasApiKey = Boolean(value.CEQUENS_API_KEY);
    const oauthParts = [value.CEQUENS_CLIENT_ID, value.CEQUENS_CLIENT_SECRET, value.CEQUENS_USERNAME, value.CEQUENS_PASSWORD];
    const oauthPresent = oauthParts.filter(Boolean).length;
    const hasOauth = oauthPresent === oauthParts.length;
    const anyCequens = hasApiKey || oauthPresent > 0 || Boolean(value.CEQUENS_SENDER_NAME);

    if (anyCequens && !((hasApiKey || hasOauth) && value.CEQUENS_SENDER_NAME)) {
      return helpers.message({
        custom:
          'إعداد CEQUENS ناقص — لازم CEQUENS_SENDER_NAME مع (CEQUENS_API_KEY أو الأربع قيم CLIENT_ID/CLIENT_SECRET/USERNAME/PASSWORD). سيبهم كلهم فاضيين لو مش عايز SMS (القناة تبقى log-only)، أو كمّلهم — التجهيز الناقص بيخلي الرسايل تروح للوج وإنت فاكرها اتبعتت',
      });
    }
    return value;
  })
  /**
   * **الحارس اللي بيمنع تسريب وضع الاختبار للإنتاج** (docs/08 §173).
   *
   * لو `OTP_TEST_MODE=true` وصل لبيئة إنتاجية، كود الدخول بيبقى **متوقّع لكل الأرقام**. متغيّر
   * بيئة منسي في لوحة الاستضافة سيناريو واقعي جدًا، فالفصل مابيتسابش لمراجعة بشرية: السيرفر
   * **مابيقلعش** أصلاً. فشل الإقلاع صوته عالي وبيتصلّح في دقيقة؛ بايباس صامت في الإنتاج ممكن
   * يفضل شهور.
   *
   * مقصود إنه `isProductionLikeEnv` مش `=== 'production'`: النشر الحقيقي شغّال بـ`staging`
   * (شوف التعليق فوق) — الفحص ضد 'production' لوحدها كان هيخلي الحارس ده بلا أثر بالظبط في
   * البيئة اللي بتخدم مستخدمين حقيقيين.
   *
   * ### ليه رجع صلب بعد ما كان اتفتح لـClosed Beta
   *
   * الاستثناء اتعمل عشان يشغّل Closed Beta على بنية إنتاج **وقت ما الدخول كان بالـOTP** ومزوّد
   * الـSMS مش مُجهّز. مع ADR-0109 الدخول بقى برقم + رمز، فالمختبِر بيدخل برمزه العادي زي أي
   * مستخدم — **مفيش أي حاجة محتاجة كود ثابت في الإنتاج خلاص**. والاستثناء كان بيسيب أخطر حاجة
   * ممكنة (كود دخول متوقّع) واقفة على صحة قائمة أرقام في متغيّر بيئة.
   */
  .custom((value: Record<string, unknown>, helpers) => {
    if (isProductionLikeEnv(value.NODE_ENV as string | undefined) && value.OTP_TEST_MODE === true) {
      return helpers.message({
        custom:
          'OTP_TEST_MODE=true ممنوع مع NODE_ENV=staging/production — ده بيخلي كود الدخول متوقّعًا. الدخول بقى برقم + رمز (ADR-0109) فمفيش أي داعي للوضع ده في الإنتاج: شيل المتغيّر أو سيبه false',
      });
    }
    return value;
  });
