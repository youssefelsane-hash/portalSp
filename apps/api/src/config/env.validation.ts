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
});
