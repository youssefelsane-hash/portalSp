import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  DATABASE_URL: Joi.string().uri().required(),

  // في الإنتاج (NODE_ENV=production) بس: طول أدنى أعلى (32 بدل 16) ورفض صريح للقيم الافتراضية
  // الموجودة في .env.example — عشان لو حد نسي يستبدلها وقت النشر الحقيقي، السيرفر يرفض يشتغل
  // من الأول (fail-fast) بدل ما يشتغل بسر ضعيف/معروف مسبقاً. في التطوير/الاختبار القيم
  // الافتراضية من .env.example لسه شغالة عادي (نفس دليل التشغيل المحلي في README.md الرئيسي).
  JWT_ACCESS_SECRET: Joi.string()
    .min(16)
    .required()
    .when('NODE_ENV', { is: 'production', then: Joi.string().min(32).invalid('change-me-access-secret') }),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string()
    .min(16)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET')) // نفس السر لـaccess وrefresh يلغي فائدة فصلهم بالكامل
    .when('NODE_ENV', { is: 'production', then: Joi.string().min(32).invalid('change-me-refresh-secret') }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  // قائمة أصول (origins) مسموح لها بنداء الـAPI من متصفح، مفصولة بفاصلة — راجع الشرح الكامل في
  // main.ts. فاضي/غير موجود = مفتوح للكل (`*`)، مقبول في التطوير بس مرفوض صراحة في الإنتاج.
  CORS_ORIGIN: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', { is: 'production', then: Joi.string().min(1).required() }),

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),

  // WebAuthn/Passkeys لدخول الأدمن (ADR-0011) — قيم localhost الافتراضية شغالة في التطوير بس،
  // مرفوضة صراحة في الإنتاج (نفس فلسفة JWT secrets فوق) — لو نسيت تظبطهم، السيرفر يرفض يشتغل
  // بدل ما WebAuthn يترفض بصمت من كل متصفح حقيقي.
  WEBAUTHN_RP_NAME: Joi.string().default('صُنّاع — لوحة التحكم'),
  WEBAUTHN_RP_ID: Joi.string()
    .default('localhost')
    .when('NODE_ENV', { is: 'production', then: Joi.string().invalid('localhost') }),
  WEBAUTHN_ORIGIN: Joi.string()
    .uri()
    .default('http://localhost:3001')
    .when('NODE_ENV', { is: 'production', then: Joi.string().uri().invalid('http://localhost:3001') }),

  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),

  // بوابة الدفع بالبطاقة (Paymob) — اختيارية عمداً، الكاش والمحفظة بيشتغلوا من غيرها.
  // تفاصيل الحصول على كل قيمة: docs/03-external-integrations.md
  // `.allow('')` — بَقّة حقيقية اتلقطت واتصلحت (2026-08-11): .env.example نفسه بيسيب القيم دي
  // فاضية (`KEY=`) وبيقول "انسخه لـ.env محلياً"، لكن Joi.string().optional() لوحدها بترفض قيمة
  // فاضية موجودة (`''`) — مختلف عن القيمة غير الموجودة خالص. نسخ .env.example زي ما هو كان
  // بيكسر تشغيل السيرفر بالكامل (Config validation error) بدل ما "يرجع log-only" زي الموثّق.
  PAYMOB_BASE_URL: Joi.string().uri().default('https://accept.paymob.com'),
  PAYMOB_API_KEY: Joi.string().allow('').optional(),
  PAYMOB_INTEGRATION_ID_CARD: Joi.string().allow('').optional(),
  PAYMOB_IFRAME_ID: Joi.string().allow('').optional(),
  PAYMOB_HMAC_SECRET: Joi.string().allow('').optional(),

  // بوابة تانية جنب Paymob (كود مرجعي "ادفع في أقرب فوري") — اختيارية بالكامل برضه.
  // تفاصيل الحصول على كل قيمة، وتحذير مهم عن التحقق من توقيع HMAC قبل الإنتاج: docs/03-external-integrations.md
  FAWRY_BASE_URL: Joi.string().uri().default('https://atfawry.fawrystaging.com'),
  FAWRY_MERCHANT_CODE: Joi.string().allow('').optional(),
  FAWRY_SECURE_KEY: Joi.string().allow('').optional(),
  FAWRY_REFERENCE_EXPIRY_HOURS: Joi.number().default(72),

  // تخزين الملفات — 'local' افتراضي (تطوير)، 'S3' للإنتاج. تفاصيل كل قيمة: docs/03-external-integrations.md
  STORAGE_PROVIDER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./uploads'),
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
});
