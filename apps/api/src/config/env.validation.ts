import * as Joi from 'joi';

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

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),

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
  // docs/08 §19 بند 16 — بوابة SMS (Twilio) هي القناة الوحيدة لتسليم كود OTP في الكود الحالي
  // (auth.service.ts، صفر بديل — لا WhatsApp ولا إيميل للـOTP). لو مش مُعدّة، السيرفر كان بيقلع
  // "healthy" في الإنتاج والـOTP endpoints بترجع 200 بلا ما أي رقم حقيقي يستلم كود خالص — مفيش
  // طريقة تانية لأي مستخدم حقيقي يسجّل دخول أو يعمل حساب. فحص عابر للحقول (مش .when() عادي لأن
  // TWILIO_ACCOUNT_SID/AUTH_TOKEN/SMS_FROM_NUMBER التلاتة لازم يكونوا موجودين مع بعض).
  .custom((value: Record<string, unknown>, helpers) => {
    if (isProductionLikeEnv(value.NODE_ENV as string | undefined)) {
      const hasTwilioSms = value.TWILIO_ACCOUNT_SID && value.TWILIO_AUTH_TOKEN && value.TWILIO_SMS_FROM_NUMBER;
      if (!hasTwilioSms) {
        return helpers.message({
          custom:
            'TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_SMS_FROM_NUMBER الثلاثة لازم يكونوا موجودين في staging/production — بوابة SMS هي القناة الوحيدة لتسليم كود OTP، من غيرها مفيش مستخدم حقيقي يقدر يسجّل دخول',
        });
      }
    }
    return value;
  });
