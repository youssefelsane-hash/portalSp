import { getRedisUrl } from './redis-url.util';

export default () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES ?? '5', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
  },

  storage: {
    // محلي بس في التطوير — الإنتاج يبدّلها لـ S3-compatible (§2.2 في الماستر بلان)
    localDir: process.env.STORAGE_LOCAL_DIR ?? './uploads',
  },

  redis: {
    url: getRedisUrl(),
  },

  payments: {
    paymob: {
      // كل القيم دي اختيارية عمداً — لو ناقصة، PaymobGatewayService.isConfigured بيبقى false
      // والدفع بالبطاقة بيرفض بوضوح (DisabledPaymentGateway/PaymobGatewayService غير مُعدّة)
      // من غير ما يمنع الكاش/المحفظة. تفاصيل الحصول على كل قيمة في docs/03-external-integrations.md.
      baseUrl: process.env.PAYMOB_BASE_URL ?? 'https://accept.paymob.com',
      apiKey: process.env.PAYMOB_API_KEY,
      integrationIdCard: process.env.PAYMOB_INTEGRATION_ID_CARD,
      iframeId: process.env.PAYMOB_IFRAME_ID,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET,
    },
  },
});
