import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),

  DATABASE_URL: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  OTP_EXPIRY_MINUTES: Joi.number().default(5),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),

  REDIS_URL: Joi.string().uri().default('redis://localhost:6379'),

  // بوابة الدفع بالبطاقة (Paymob) — اختيارية عمداً، الكاش والمحفظة بيشتغلوا من غيرها.
  // تفاصيل الحصول على كل قيمة: docs/03-external-integrations.md
  PAYMOB_BASE_URL: Joi.string().uri().default('https://accept.paymob.com'),
  PAYMOB_API_KEY: Joi.string().optional(),
  PAYMOB_INTEGRATION_ID_CARD: Joi.string().optional(),
  PAYMOB_IFRAME_ID: Joi.string().optional(),
  PAYMOB_HMAC_SECRET: Joi.string().optional(),

  // بوابة تانية جنب Paymob (كود مرجعي "ادفع في أقرب فوري") — اختيارية بالكامل برضه.
  // تفاصيل الحصول على كل قيمة، وتحذير مهم عن التحقق من توقيع HMAC قبل الإنتاج: docs/03-external-integrations.md
  FAWRY_BASE_URL: Joi.string().uri().default('https://atfawry.fawrystaging.com'),
  FAWRY_MERCHANT_CODE: Joi.string().optional(),
  FAWRY_SECURE_KEY: Joi.string().optional(),
  FAWRY_REFERENCE_EXPIRY_HOURS: Joi.number().default(72),

  // تخزين الملفات — 'local' افتراضي (تطوير)، 'S3' للإنتاج. تفاصيل كل قيمة: docs/03-external-integrations.md
  STORAGE_PROVIDER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_DIR: Joi.string().default('./uploads'),
  S3_ENDPOINT: Joi.string().uri().optional(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().optional(),
  S3_ACCESS_KEY_ID: Joi.string().optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().optional(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  STORAGE_S3_URL_EXPIRY_SECONDS: Joi.number().default(60 * 60 * 24 * 7),

  // قنوات الإشعارات الخارجية — كل واحدة اختيارية بالكامل ومستقلة عن الباقي (قناة مش مُعدّة
  // بترجع log-only، مش بتفشّل). تفاصيل كل قيمة: docs/03-external-integrations.md
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional(),
  TWILIO_ACCOUNT_SID: Joi.string().optional(),
  TWILIO_AUTH_TOKEN: Joi.string().optional(),
  TWILIO_SMS_FROM_NUMBER: Joi.string().optional(),
  TWILIO_WHATSAPP_FROM_NUMBER: Joi.string().optional(),
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().optional(),
  SMTP_FROM_EMAIL: Joi.string().optional(),
});
