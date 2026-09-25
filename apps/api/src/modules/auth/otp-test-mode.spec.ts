import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as Joi from 'joi';
import { envValidationSchema } from '../../config/env.validation';
import { SMS_DISPATCHER, SmsDispatcher } from '../../common/notifications/sms-dispatcher';
import { AuthService } from './auth.service';
import {
  isAllowedOtpTestPhone,
  OTP_TEST_MODE_DISABLED,
  OtpTestMode,
  parseTestModePhones,
  usesFixedOtp,
} from './otp-test-mode';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { MfaPolicyService } from './mfa-policy.service';
import { NotificationRoutingService } from '../notifications/notification-routing.service';
import { WebAuthnService } from './webauthn.service';
import { Wallet } from '../payments/entities/wallet.entity';
import { SettingsService } from '../settings/settings.service';

/**
 * **وضع اختبار الـOTP لفترة Google Play** (docs/08 §173).
 *
 * الضمانات اللي السويت دي بتثبّتها — كل واحدة فيها سيناريو فشل حقيقي لو اتكسرت:
 *   ١. الكود الثابت بيشتغل لما الوضع مفعّل في بيئة اختبار.
 *   ٢. أي كود تاني بيترفض — الوضع **مش** بايباس.
 *   ٣. بوابة الـSMS (CEQUENS) مابتتنداش خالص في الوضع ده.
 *   ٤. لما يتقفل، مسار الـOTP الحقيقي بيرجع زي ما هو (كود عشوائي + إرسال).
 *   ٥. في Production Beta، القائمة الصريحة إلزامية وأي رقم خارجها يُرفض قبل كتابة OTP أو SMS.
 *   ٦. الـclient مايقدرش يفعّله ولا يتحكم فيه.
 *   ٧. باقي حمايات الـOTP (المحاولات، الصلاحية، إلغاء الأقدم) بتفضل سارية.
 */

class FakeRepository<T extends { id?: string }> {
  public rows: T[] = [];
  private nextId = 1;
  create(partial: Partial<T>): T {
    return { ...(partial as T) };
  }
  async save(entity: T): Promise<T> {
    if (!entity.id) {
      entity.id = `fake-id-${this.nextId++}`;
      this.rows.push(entity);
    } else {
      const idx = this.rows.findIndex((r) => r.id === entity.id);
      if (idx >= 0) this.rows[idx] = entity;
      else this.rows.push(entity);
    }
    return entity;
  }
  async update(where: Partial<T>, patch: Partial<T>): Promise<void> {
    const entries = Object.entries(where) as [keyof T, unknown][];
    this.rows.filter((row) => entries.every(([k, v]) => row[k] === v)).forEach((row) => Object.assign(row, patch));
  }
}

/** `DataSource` وهمية بتخدم بالظبط النداءات اللي `requestOtp`/`consumeOtp` بيعملوها. */
function createFakeDataSource(otpCodes: FakeRepository<OtpCode>): DataSource {
  const manager = {
    query: async () => [],
    getRepository: () => otpCodes,
    save: async (entity: OtpCode) => otpCodes.save(entity),
    createQueryBuilder: (_entity: unknown, _alias: string) => {
      const filters: Record<string, unknown> = {};
      let limit = Infinity;
      const builder = {
        setLock: () => builder,
        where: (_c: string, p: Record<string, unknown>) => (Object.assign(filters, p), builder),
        andWhere: (c: string, p?: Record<string, unknown>) => {
          if (p) Object.assign(filters, p);
          if (c.includes('isUsed = false')) filters.isUsed = false;
          return builder;
        },
        orderBy: () => builder,
        limit: (n: number) => ((limit = n), builder),
        getOne: async () => {
          const matched = otpCodes.rows.filter(
            (r) =>
              r.phoneNumber === filters.phoneNumber &&
              r.purpose === filters.purpose &&
              (filters.isUsed === undefined || r.isUsed === filters.isUsed),
          );
          return matched[matched.length - 1] ?? null;
        },
        getMany: async () => {
          const matched = otpCodes.rows.filter(
            (r) =>
              r.phoneNumber === filters.phoneNumber &&
              r.purpose === filters.purpose &&
              (filters.excludeOtpId === undefined || r.id !== filters.excludeOtpId),
          );
          return matched.reverse().slice(0, limit);
        },
      };
      return builder;
    },
  } as unknown as EntityManager;
  return { transaction: async (cb: (m: EntityManager) => Promise<unknown>) => cb(manager) } as unknown as DataSource;
}

interface Harness {
  service: AuthService;
  otpCodes: FakeRepository<OtpCode>;
  smsSend: jest.Mock;
}

async function buildAuth(overrides: Record<string, unknown>): Promise<Harness> {
  const otpCodes = new FakeRepository<OtpCode>();
  const smsSend = jest.fn().mockResolvedValue({ delivered: true, failureReason: null });
  const sms: SmsDispatcher = { isConfigured: true, providerName: 'cequens', send: smsSend };
  const values: Record<string, unknown> = {
    nodeEnv: 'test',
    'otp.expiryMinutes': 5,
    'otp.maxAttempts': 5,
    'otp.testMode': OTP_TEST_MODE_DISABLED,
    'jwt.accessSecret': 'test-access-secret-0123456789',
    'jwt.refreshSecret': 'test-refresh-secret-0123456789',
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      JwtService,
      { provide: SMS_DISPATCHER, useValue: sms },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      { provide: ConfigService, useValue: { get: (key: string) => values[key] } },
      { provide: getRepositoryToken(User), useValue: new FakeRepository<User>() },
      { provide: getRepositoryToken(OtpCode), useValue: otpCodes },
      { provide: getRepositoryToken(RefreshToken), useValue: new FakeRepository<RefreshToken>() },
      { provide: getRepositoryToken(Wallet), useValue: new FakeRepository<Wallet>() },
      { provide: DataSource, useValue: createFakeDataSource(otpCodes) },
      { provide: MfaPolicyService, useValue: { userRequiresMfa: jest.fn().mockResolvedValue(false) } },
      { provide: WebAuthnService, useValue: { hasAnyCredential: jest.fn().mockResolvedValue(false) } },
      // ADR-0109 — `auth.login_method`. السبيكات دي بتختبر مسار الـOTP، فالـstub بيرجّع 'otp'
      // عشان سلوكها يفضل زي ما هو بالحرف بعد ما البوابة اتحطت على `requestOtp`.
      { provide: SettingsService, useValue: { getString: async () => 'otp' } },
      { provide: NotificationRoutingService, useValue: { routeToRole: jest.fn() } },
    ],
  }).compile();
  return { service: moduleRef.get(AuthService), otpCodes, smsSend };
}

const TEST_MODE_ON: OtpTestMode = { enabled: true, fixedCode: '111111', allowedPhones: [] };
const PHONE = '+201001234567';
/** `consumeOtp` خاصة — الاختبار بينادي عبرها زي ما `verifyOtp` بيعمل بالظبط. */
const consume = (service: AuthService, code: string) =>
  (service as unknown as { consumeOtp(p: string, c: string, u: OtpPurpose): Promise<OtpCode> }).consumeOtp(
    PHONE,
    code,
    OtpPurpose.LOGIN,
  );

describe('وضع اختبار الـOTP — السلوك (docs/08 §173)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('١) الكود الثابت بيتقبل لما الوضع مفعّل', async () => {
    const { service } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    const otp = await consume(service, '111111');
    expect(otp.isUsed).toBe(true);
  });

  it('٢) أي كود تاني بيترفض — الوضع مش بايباس', async () => {
    const { service } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    await expect(consume(service, '222222')).rejects.toMatchObject({ code: 'AUTH_003' });
    await expect(consume(service, '000000')).rejects.toMatchObject({ code: 'AUTH_003' });
  });

  it('٣) بوابة الـSMS مابتتنداش خالص في وضع الاختبار (مفيش CEQUENS)', async () => {
    const { service, smsSend } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('٤) لما يتقفل: كود عشوائي + إرسال SMS حقيقي، والكود الثابت بيترفض', async () => {
    const { service, smsSend } = await buildAuth({});
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    expect(smsSend).toHaveBeenCalledTimes(1);
    // احتمال إن العشوائي يطلع 111111 هو ١ في المليون — والرفض هنا هو المقصود.
    await expect(consume(service, '111111')).rejects.toBeDefined();
  });

  it('٦) الـclient مايقدرش يفعّل الوضع — مفيش حقل في الـDTO ولا تأثير لأي حاجة بيبعتها', async () => {
    const { service, smsSend } = await buildAuth({});
    // حقول ملفّقة زي ما مهاجم ممكن يبعتها؛ الـwhitelist في ValidationPipe بيشيلها أصلاً،
    // والسلوك هنا بيثبت إنها مالهاش أي أثر حتى لو وصلت للخدمة.
    await service.requestOtp(
      { phone_number: PHONE, purpose: OtpPurpose.LOGIN, test_mode: true, otp_test_mode: true } as never,
      null,
    );
    expect(smsSend).toHaveBeenCalledTimes(1);
    await expect(consume(service, '111111')).rejects.toBeDefined();
  });

  it('٧) عدّاد المحاولات بيفضل شغّال في وضع الاختبار زي ما هو', async () => {
    const { service, otpCodes } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(consume(service, '999999')).rejects.toMatchObject({ code: 'AUTH_003' });
    }
    expect(otpCodes.rows[0].attemptsCount).toBe(5);
    // بعد استهلاك المحاولات، حتى الكود الثابت الصح بيترفض.
    await expect(consume(service, '111111')).rejects.toMatchObject({ code: 'AUTH_004' });
  });

  it('٧-ب) الكود الثابت بينتهي بالصلاحية زي أي كود — مفيش استثناء', async () => {
    const { service, otpCodes } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    otpCodes.rows[0].expiresAt = new Date(Date.now() - 1_000);
    await expect(consume(service, '111111')).rejects.toMatchObject({ code: 'AUTH_003' });
  });

  it('٧-ج) إعادة الطلب بتلغي الكود الأقدم — قاعدة «كود واحد صالح» سارية', async () => {
    const { service, otpCodes } = await buildAuth({ 'otp.testMode': TEST_MODE_ON });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    expect(otpCodes.rows.filter((r) => !r.isUsed)).toHaveLength(1);
    const otp = await consume(service, '111111');
    expect(otp.id).toBe(otpCodes.rows[1].id);
  });

  it('Production Beta: الرقم خارج القائمة يُرفض قبل إنشاء OTP أو محاولة SMS', async () => {
    const { service, smsSend, otpCodes } = await buildAuth({
      nodeEnv: 'production',
      'otp.testMode': { enabled: true, fixedCode: '111111', allowedPhones: ['+201009998887'] },
    });
    await expect(service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null)).rejects.toMatchObject({
      code: 'AUTH_007',
      reason: 'closed_beta',
    });
    expect(otpCodes.rows).toHaveLength(0);
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('Production Beta: الرقم الموجود في القائمة يأخذ الكود الثابت بلا SMS', async () => {
    const { service, smsSend } = await buildAuth({
      nodeEnv: 'production',
      'otp.testMode': { enabled: true, fixedCode: '111111', allowedPhones: [PHONE] },
    });
    await service.requestOtp({ phone_number: PHONE, purpose: OtpPurpose.LOGIN }, null);
    expect(smsSend).not.toHaveBeenCalled();
    expect((await consume(service, '111111')).isUsed).toBe(true);
  });
});

describe('وضع اختبار الـOTP — قرار التفعيل (دوال نقية)', () => {
  it('مقفول افتراضيًا', () => {
    expect(usesFixedOtp(OTP_TEST_MODE_DISABLED, PHONE)).toBe(false);
  });

  it('قايمة فاضية = كل الأرقام؛ قايمة مليانة = المحدّدين بس', () => {
    expect(usesFixedOtp(TEST_MODE_ON, PHONE)).toBe(true);
    const scoped: OtpTestMode = { enabled: true, fixedCode: '111111', allowedPhones: ['+201009998887'] };
    expect(usesFixedOtp(scoped, PHONE)).toBe(false);
    expect(usesFixedOtp(scoped, '+201009998887')).toBe(true);
  });

  it('فحص الـallowlist الصريح لا يفتح القائمة الفارغة لأي رقم', () => {
    expect(isAllowedOtpTestPhone(TEST_MODE_ON, PHONE)).toBe(false);
    const scoped: OtpTestMode = { enabled: true, fixedCode: '111111', allowedPhones: [PHONE] };
    expect(isAllowedOtpTestPhone(scoped, PHONE)).toBe(true);
  });

  it('المقارنة بعد التطبيع — نفس الرقم بصيغة تانية بيتعرف', () => {
    const scoped: OtpTestMode = {
      enabled: true,
      fixedCode: '111111',
      allowedPhones: parseTestModePhones(' +20 100 999 8887 , +20-100-111-2222'),
    };
    expect(scoped.allowedPhones).toEqual(['+201009998887', '+201001112222']);
    expect(usesFixedOtp(scoped, '+201009998887')).toBe(true);
  });

  // صيغة مش قابلة للتحليل (زي بادئة 0020) بتفضل زي ما هي فمابتطابقش رقم E.164 الجاي من الـDTO
  // — الفشل هنا **مقفول**: المختبر بياخد كود حقيقي بـSMS، مش بايباس.
  it('صيغة غير صالحة في القايمة بتفشل مقفولة — مابتفتحش الوضع لحد', () => {
    const scoped: OtpTestMode = { enabled: true, fixedCode: '111111', allowedPhones: parseTestModePhones('0020 100 999 8887') };
    expect(scoped.allowedPhones).toEqual(['0020 100 999 8887']);
    expect(usesFixedOtp(scoped, '+201009998887')).toBe(false);
  });

  it('كود ثابت فاضي = الوضع مالوش أثر (حماية من إعداد ناقص)', () => {
    expect(usesFixedOtp({ enabled: true, fixedCode: '', allowedPhones: [] }, PHONE)).toBe(false);
  });
});

describe('وضع Closed Beta OTP — حارس الإقلاع (docs/08 §173)', () => {
  const baseEnv = {
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    SETTINGS_ENCRYPTION_KEY: 'c'.repeat(40),
    PII_ENCRYPTION_KEY: 'd'.repeat(40),
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    CORS_ORIGIN: 'https://admin.ostahome.com',
    // مطلوب في البيئات الإنتاجية (وجهة الـQR لما مفيش متجر — تدقيق 2026-09-20).
    CUSTOMER_WEB_URL: 'https://ostahome.com',
    ADMIN_BASE_URL: 'https://admin.ostahome.com',
    WEBAUTHN_RP_ID: 'admin.ostahome.com',
    WEBAUTHN_ORIGIN: 'https://admin.ostahome.com',
    SMS_PROVIDER: 'cequens',
    CEQUENS_API_KEY: 'key',
    CEQUENS_SENDER_NAME: 'OSTA',
    // حارس التخزين في env.validation بيرفض 'local' في البيئات الإنتاجية ويستلزم بيانات الـbucket
    STORAGE_PROVIDER: 's3',
    S3_BUCKET: 'osta-test-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key-id',
    S3_SECRET_ACCESS_KEY: 'test-secret-access-key',
  };
  // أقل مجموعة مطلوبة في التطوير — الحقول المطلوبة بلا شرط بيئة
  const devEnv = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
  };
  const validate = (env: Record<string, unknown>) =>
    (envValidationSchema as Joi.ObjectSchema).validate(env, { allowUnknown: true, abortEarly: false });

  const productionBetaEnv = (nodeEnv: 'production' | 'staging') => {
    const env: Record<string, unknown> = {
      ...baseEnv,
      NODE_ENV: nodeEnv,
      OTP_TEST_MODE: 'true',
      OTP_TEST_MODE_CODE: '483927',
      OTP_TEST_MODE_PHONES: PHONE,
    };
    delete env.CEQUENS_API_KEY;
    delete env.CEQUENS_SENDER_NAME;
    return env;
  };

  it('٥) Production Beta بقائمة صريحة يعدّي بلا CEQUENS — لأن SMS لن يُستدعى', () => {
    const { error } = validate(productionBetaEnv('production'));
    expect(error).toBeUndefined();
  });

  it('٥-ب) staging يخضع لنفس Closed Beta الصارم', () => {
    const { error } = validate(productionBetaEnv('staging'));
    expect(error).toBeUndefined();
  });

  it('٥-ج) Production Beta بقائمة فارغة يرفض الإقلاع بدل فتح الكود الثابت للجميع', () => {
    const { error } = validate({ ...productionBetaEnv('production'), OTP_TEST_MODE_PHONES: '' });
    expect(error?.message).toContain('OTP_TEST_MODE_PHONES غير فارغ');
  });

  it('٥-د) Production Beta يرفض كود 111111 الافتراضي', () => {
    const { error } = validate({ ...productionBetaEnv('production'), OTP_TEST_MODE_CODE: '111111' });
    expect(error?.message).toContain('OTP_TEST_MODE_CODE');
  });

  it('٥-هـ) Production Beta يرفض رقمًا غير صالح في القائمة', () => {
    const { error } = validate({ ...productionBetaEnv('production'), OTP_TEST_MODE_PHONES: '00201009998887' });
    expect(error?.message).toContain('OTP_TEST_MODE_PHONES');
  });

  it('production بلا الوضع بيعدّي عادي — الحارس مابيكسرش الإنتاج', () => {
    const { error } = validate({ ...baseEnv, NODE_ENV: 'production' });
    expect(error).toBeUndefined();
  });

  it('development + الوضع مفعّل بيعدّي — ده الاستخدام المقصود', () => {
    const { error, value } = validate({ ...devEnv, NODE_ENV: 'development', OTP_TEST_MODE: 'true' });
    expect(error).toBeUndefined();
    expect(value.OTP_TEST_MODE).toBe(true);
    expect(value.OTP_TEST_MODE_CODE).toBe('111111');
  });

  it('كود اختبار بطول غلط بيترفض — شاشة الإدخال ٦ خانات', () => {
    const { error } = validate({ ...devEnv, NODE_ENV: 'development', OTP_TEST_MODE: 'true', OTP_TEST_MODE_CODE: '1111' });
    expect(error).toBeDefined();
  });
});
