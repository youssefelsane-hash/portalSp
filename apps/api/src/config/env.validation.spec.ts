import { envValidationSchema } from './env.validation';

// docs/08 §19 بند 16 — يثبت إصلاح فجوة "النظام يقدر يقلع 'healthy' في الإنتاج وهو ناقص
// STORAGE_PROVIDER=s3/بوابة SMS حقيقية" (نفس فلسفة فحوصات JWT/CORS/WebAuthn الموجودة من زمان).
const MINIMAL_VALID_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  SETTINGS_ENCRYPTION_KEY: 'c'.repeat(32),
  CORS_ORIGIN: 'https://app.example.com',
  WEBAUTHN_RP_ID: 'example.com',
  WEBAUTHN_ORIGIN: 'https://app.example.com',
  STORAGE_PROVIDER: 's3',
  // المزوّد الافتراضي بعد هجرة 2026-09-10 — القيم دي **وهمية** ومالهاش أي علاقة بأي حساب حقيقي.
  SMS_PROVIDER: 'cequens',
  CEQUENS_API_KEY: 'fake-api-key-for-tests',
  CEQUENS_SENDER_NAME: 'OSTA',
};

/** نفس الـenv بس بمزوّد Twilio — البديل الاحتياطي، لسه لازم يتفحص بنفس الصرامة. */
const MINIMAL_VALID_PRODUCTION_ENV_TWILIO = {
  ...MINIMAL_VALID_PRODUCTION_ENV,
  SMS_PROVIDER: 'twilio',
  CEQUENS_API_KEY: undefined,
  CEQUENS_SENDER_NAME: undefined,
  TWILIO_ACCOUNT_SID: 'AC-real',
  TWILIO_AUTH_TOKEN: 'real-token',
  TWILIO_SMS_FROM_NUMBER: '+201000000000',
};

describe('envValidationSchema — docs/08 §19 بند 16 (fail-fast للإعدادات الحرجة في الإنتاج)', () => {
  it('env إنتاج كامل (كل القيم الحرجة مُعدّة) بيعدّي بلا أي خطأ', () => {
    const { error } = envValidationSchema.validate(MINIMAL_VALID_PRODUCTION_ENV, { allowUnknown: true });
    expect(error).toBeUndefined();
  });

  it('STORAGE_PROVIDER=local (الافتراضي) في الإنتاج يترفض — كان بيسمح للسيرفر يقلع وهو بيكتب على قرص محلي مؤقت', () => {
    const { error } = envValidationSchema.validate(
      { ...MINIMAL_VALID_PRODUCTION_ENV, STORAGE_PROVIDER: 'local' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_PROVIDER');
  });

  it('STORAGE_PROVIDER مش مُعدّة خالص في الإنتاج (تعتمد على الافتراضي local) يترفض برضه', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).STORAGE_PROVIDER;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
  });

  it('مفيش أي بيانات اعتماد CEQUENS في الإنتاج يترفض — القناة الوحيدة لتسليم كود OTP', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).CEQUENS_API_KEY;
    delete (env as Record<string, unknown>).CEQUENS_SENDER_NAME;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('CEQUENS');
  });

  it('CEQUENS بمفتاح API بلا اسم مُرسِل يترفض — الرسالة نفسها بترفض من المزوّد من غير Sender ID معتمد', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).CEQUENS_SENDER_NAME;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('CEQUENS');
  });

  it('CEQUENS بمسار OAuth كامل (بلا مفتاح API) يعدّي — الحساب هو اللي بيحدد المسار المفعّل', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV } as Record<string, unknown>;
    delete env.CEQUENS_API_KEY;
    const { error } = envValidationSchema.validate(
      {
        ...env,
        CEQUENS_CLIENT_ID: 'fake-client',
        CEQUENS_CLIENT_SECRET: 'fake-secret',
        CEQUENS_USERNAME: 'fake-user',
        CEQUENS_PASSWORD: 'fake-pass',
      },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });

  it('CEQUENS بمسار OAuth ناقص قيمة واحدة يترفض — الأربعة لازم مع بعض', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV } as Record<string, unknown>;
    delete env.CEQUENS_API_KEY;
    const { error } = envValidationSchema.validate(
      { ...env, CEQUENS_CLIENT_ID: 'fake-client', CEQUENS_CLIENT_SECRET: 'fake-secret', CEQUENS_USERNAME: 'fake-user' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });

  it('SMS_PROVIDER=twilio بإعداد Twilio كامل يعدّي — البديل الاحتياطي لسه مدعوم بالكامل', () => {
    const { error } = envValidationSchema.validate(MINIMAL_VALID_PRODUCTION_ENV_TWILIO, { allowUnknown: true });
    expect(error).toBeUndefined();
  });

  it('SMS_PROVIDER=twilio مُعدّ جزئيًا (SID/TOKEN بلا رقم المرسل) يترفض — التلاتة لازم مع بعض', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV_TWILIO };
    delete (env as Record<string, unknown>).TWILIO_SMS_FROM_NUMBER;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('TWILIO');
  });

  it('SMS_PROVIDER=twilio بلا أي بيانات Twilio **مايعدّيش** حتى لو CEQUENS مُعدّ — الحارس بيتبع المزوّد المختار', () => {
    const { error } = envValidationSchema.validate(
      { ...MINIMAL_VALID_PRODUCTION_ENV, SMS_PROVIDER: 'twilio' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('TWILIO');
  });

  it('SMS_PROVIDER بقيمة مش معروفة يترفض — بدل ما يقع بصمت على الافتراضي', () => {
    const { error } = envValidationSchema.validate(
      { ...MINIMAL_VALID_PRODUCTION_ENV, SMS_PROVIDER: 'nexmo' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('SMS_PROVIDER');
  });

  it('WEBAUTHN_RP_ID مش مُعدّة خالص في الإنتاج يترفض — بَقّة مطابقة اتلقطت أثناء بناء بند 16 (defaults كانت بتتخطى فحص .when())', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).WEBAUTHN_RP_ID;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('WEBAUTHN_RP_ID');
  });

  it('WEBAUTHN_ORIGIN مش مُعدّة خالص في الإنتاج يترفض برضه (نفس البَقّة بالحرف)', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).WEBAUTHN_ORIGIN;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('WEBAUTHN_ORIGIN');
  });

  it('نفس الفجوتين متسامح فيهم في التطوير (NODE_ENV=development) — مايكسرش دليل التشغيل المحلي', () => {
    const { error } = envValidationSchema.validate(
      {
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        JWT_ACCESS_SECRET: 'change-me-access-secret',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret',
      },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined();
  });
});

// Script 2 Part M (finding #63) — بَقّة حقيقية خطيرة اتلقطت أثناء مراجعة Part G: كل الفحوصات فوق
// كانت بتتفحص ضد NODE_ENV==='production' بس، لكن النشر الفعلي الحقيقي (Railway) شغال فعلاً
// بـNODE_ENV=staging — قرار تشغيلي سابق (راجع docs/15)، مش بيئة QA معزولة ببيانات وهمية. يعني
// كل حمايات fail-fast دي (بما فيها STORAGE_PROVIDER≠local وTwilio SMS الإجبارية) كانت متخطّاة
// فعليًا على البيئة الحقيقية اللي بيستخدمها مستخدمين حقيقيين. الاختبارات دي بتثبت إن 'staging'
// بقى بنفس صرامة 'production' تمامًا لكل فحص.
describe('envValidationSchema — staging لازم يتفحص بنفس صرامة production (Script 2 Part M finding #63)', () => {
  const MINIMAL_VALID_STAGING_ENV = { ...MINIMAL_VALID_PRODUCTION_ENV, NODE_ENV: 'staging' };

  it('env staging كامل (كل القيم الحرجة مُعدّة) بيعدّي بلا أي خطأ', () => {
    const { error } = envValidationSchema.validate(MINIMAL_VALID_STAGING_ENV, { allowUnknown: true });
    expect(error).toBeUndefined();
  });

  it('STORAGE_PROVIDER=local في staging يترفض — نفس فحص production بالحرف', () => {
    const { error } = envValidationSchema.validate(
      { ...MINIMAL_VALID_STAGING_ENV, STORAGE_PROVIDER: 'local' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_PROVIDER');
  });

  it('مفيش بيانات اعتماد بوابة SMS في staging يترفض — نفس فحص production بالحرف', () => {
    const env = { ...MINIMAL_VALID_STAGING_ENV };
    delete (env as Record<string, unknown>).CEQUENS_API_KEY;
    delete (env as Record<string, unknown>).CEQUENS_SENDER_NAME;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('CEQUENS');
  });

  it('JWT secrets قصيرة/افتراضية في staging يترفضوا — نفس فحص production بالحرف', () => {
    const { error } = envValidationSchema.validate(
      { ...MINIMAL_VALID_STAGING_ENV, JWT_ACCESS_SECRET: 'change-me-access-secret'.padEnd(32, 'x') },
      { allowUnknown: true },
    );
    expect(error).toBeUndefined(); // padEnd يخليها طويلة بما يكفي وغير مطابقة للقيمة المرفوضة بالظبط — فحص سلبي (تأكيد الشرط شغال، مش خطأ)
    const rejected = envValidationSchema.validate(
      { ...MINIMAL_VALID_STAGING_ENV, JWT_ACCESS_SECRET: 'short' },
      { allowUnknown: true },
    );
    expect(rejected.error).toBeDefined();
  });

  it('WEBAUTHN_RP_ID مش مُعدّة خالص في staging يترفض — نفس فحص production بالحرف', () => {
    const env = { ...MINIMAL_VALID_STAGING_ENV };
    delete (env as Record<string, unknown>).WEBAUTHN_RP_ID;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('WEBAUTHN_RP_ID');
  });
});
