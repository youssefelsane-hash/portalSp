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
    // 'local' (افتراضي، للتطوير) أو 's3' — راجع common/storage/storage.provider.ts
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localDir: process.env.STORAGE_LOCAL_DIR ?? './uploads',
    s3: {
      // كل القيم دي مطلوبة فعلياً بس لو STORAGE_PROVIDER=s3 — تفاصيل الحصول عليها:
      // docs/03-external-integrations.md → قسم S3-compatible storage
      endpoint: process.env.S3_ENDPOINT, // اسيبه فاضي لـ AWS S3 نفسه؛ لازم لأي بديل تاني (Spaces/R2/MinIO)
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      // أقصى مدة صلاحية مسموحة لروابط SigV4 presigned فعلياً — راجع الشرح الكامل في s3-storage.service.ts
      urlExpirySeconds: parseInt(process.env.STORAGE_S3_URL_EXPIRY_SECONDS ?? String(60 * 60 * 24 * 7), 10),
    },
  },

  redis: {
    url: getRedisUrl(),
  },

  notifications: {
    // كل قيم الأقسام التلاتة دي اختيارية عمداً — قناة مش مُعدّة بترجع لـ LogOnlyNotificationDispatcher
    // (تسجيل في اللوج بس)، مش بتفشّل أو توقف باقي القنوات. تفاصيل كل قيمة: docs/03-external-integrations.md
    fcm: {
      // محتوى ملف مفتاح خدمة Firebase الكامل كـJSON (سطر واحد) — مش مسار ملف
      serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    },
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      smsFromNumber: process.env.TWILIO_SMS_FROM_NUMBER,
      whatsappFromNumber: process.env.TWILIO_WHATSAPP_FROM_NUMBER,
    },
    smtp: {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : undefined,
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      fromEmail: process.env.SMTP_FROM_EMAIL,
    },
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
