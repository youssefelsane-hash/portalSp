import { envValidationSchema } from './env.validation';

// docs/08 §19 بند 16 — يثبت إصلاح فجوة "النظام يقدر يقلع 'healthy' في الإنتاج وهو ناقص
// STORAGE_PROVIDER=s3/بوابة SMS حقيقية" (نفس فلسفة فحوصات JWT/CORS/WebAuthn الموجودة من زمان).
const MINIMAL_VALID_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CORS_ORIGIN: 'https://app.example.com',
  WEBAUTHN_RP_ID: 'example.com',
  WEBAUTHN_ORIGIN: 'https://app.example.com',
  STORAGE_PROVIDER: 's3',
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

  it('مفيش أي بيانات اعتماد Twilio SMS في الإنتاج يترفض — القناة الوحيدة لتسليم كود OTP', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).TWILIO_ACCOUNT_SID;
    delete (env as Record<string, unknown>).TWILIO_AUTH_TOKEN;
    delete (env as Record<string, unknown>).TWILIO_SMS_FROM_NUMBER;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain('TWILIO');
  });

  it('Twilio مُعدّة جزئيًا بس (SID/TOKEN بلا رقم المرسل) في الإنتاج يترفض برضه — التلاتة لازم مع بعض', () => {
    const env = { ...MINIMAL_VALID_PRODUCTION_ENV };
    delete (env as Record<string, unknown>).TWILIO_SMS_FROM_NUMBER;
    const { error } = envValidationSchema.validate(env, { allowUnknown: true });
    expect(error).toBeDefined();
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
