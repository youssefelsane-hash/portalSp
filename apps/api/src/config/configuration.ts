import { getRedisUrl } from './redis-url.util';

export default () => ({
  nodeEnv: process.env.NODE_ENV,
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
    // **القيم دي كانت افتراضيات مخفية، وواحدة منها كانت سبب تعليق الـAPI بالكامل.**
    // `poolMax` ١٠ هو نفس الافتراضي القديم — مقصود إننا ما نكبّرهوش، عشان تكبير الـpool
    // بيداري استنزافًا مش بيمنعه. `acquireTimeoutMs` هو الجديد فعلاً: الافتراضي كان
    // انتظارًا بلا نهاية.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
    acquireTimeoutMs: parseInt(process.env.DATABASE_ACQUIRE_TIMEOUT_MS ?? '10000', 10),
    idleTimeoutMs: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS ?? '30000', 10),
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },

  security: {
    settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY,
    // مفصولة بفاصلة (زي "https://admin.baytak.com,https://baytak.com") — فاضي = مفتوح للكل،
    // مرفوض في الإنتاج عبر env.validation.ts (CORS_ORIGIN مطلوبة هناك لو NODE_ENV=production).
    corsOrigins: (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES ?? '5', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
  },

  // WebAuthn/Passkeys لدخول الأدمن (ADR-0011) — القيم الافتراضية مضبوطة لبيئة التطوير المحلية
  // (apps/admin شغال على 3001). لازم تتظبط صح في الإنتاج (rpID = دومين الأدمن الحقيقي بدون
  // بروتوكول، origin = الرابط الكامل بالـhttps) وإلا كل ceremony هيترفض من المتصفح نفسه.
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'أسطى — لوحة التحكم',
    rpId: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    origin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3001',
  },

  storage: {
    // 'local' (افتراضي، للتطوير) أو 's3' — راجع common/storage/storage.provider.ts
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localDir: process.env.STORAGE_LOCAL_DIR ?? './uploads',
    // لازم رابط مطلق (scheme+host+port) — راجع الشرح الكامل في env.validation.ts جنب
    // STORAGE_LOCAL_PUBLIC_BASE_URL وlocal-disk-storage.service.ts. الافتراضي بيطابق PORT نفسه.
    localPublicBaseUrl: process.env.STORAGE_LOCAL_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT ?? '3000'}`,
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
      // API_KEY لسه لازم لـTransaction Inquiry (auth_token قديم) — Intention/Refund/Void/Capture
      // بتستخدم SECRET_KEY (Authorization: Token) بدل كده. PUBLIC_KEY لـUnified Checkout redirect
      // URL بس (ADR-0013، مش سرّ — آمن يوصل للـclient لو احتجنا مستقبلاً، بس هنا بيتستخدم سيرفر-side).
      apiKey: process.env.PAYMOB_API_KEY,
      secretKey: process.env.PAYMOB_SECRET_KEY,
      publicKey: process.env.PAYMOB_PUBLIC_KEY,
      integrationIdCard: process.env.PAYMOB_INTEGRATION_ID_CARD,
      // docs/08 §19 بند 15 — "Mobile Wallet" الحقيقي (Vodafone Cash/Orange Money/إلخ عبر نفس
      // حساب Paymob التاجر، مش حساب خارجي جديد). اختياري بالكامل — لو موجود بيتضاف لقايمة
      // payment_methods في createPayment() جنب integrationIdCard، وPaymob's Unified Checkout
      // بيعرض خيار المحفظة تلقائيًا في نفس صفحة الدفع (صفر منطق backend إضافي، صفر شاشة Flutter
      // جديدة). تفاصيل الحصول على القيمة دي من Paymob dashboard: docs/03-external-integrations.md §1.
      integrationIdMobileWallet: process.env.PAYMOB_INTEGRATION_ID_MOBILE_WALLET,
      iframeId: process.env.PAYMOB_IFRAME_ID,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET,
    },
    // بوابة تانية جنب Paymob، مش بديلة — "ادفع في أقرب فوري" (كود مرجعي، دفع كاش فعلي في نقطة
    // بيع). نفس فلسفة الإعداد الاختياري: ناقص = FawryGatewayService.isConfigured=false والدفع
    // بالكود المرجعي بيرفض بوضوح، من غير ما يأثر على أي طريقة دفع تانية. تفاصيل كاملة (بما فيها
    // تحذير مهم عن دقة توقيع HMAC المفترض) في docs/03-external-integrations.md.
    fawry: {
      baseUrl: process.env.FAWRY_BASE_URL ?? 'https://atfawry.fawrystaging.com',
      merchantCode: process.env.FAWRY_MERCHANT_CODE,
      secureKey: process.env.FAWRY_SECURE_KEY,
      referenceExpiryHours: process.env.FAWRY_REFERENCE_EXPIRY_HOURS
        ? parseInt(process.env.FAWRY_REFERENCE_EXPIRY_HOURS, 10)
        : 72,
    },
    // InstaPay: عنوان IPA/اسم المستلم بقوا يتعدّلوا من /admin/settings مش env vars (§31، طلب
    // مالك صريح 2026-08-20) — راجع InstaPayProvider وinfra/migrations/0150.
  },
});
