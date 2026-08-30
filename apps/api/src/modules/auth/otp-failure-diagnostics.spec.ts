import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User, UserType } from './entities/user.entity';

/**
 * §106 — بلاغ المالك «الكود بيظهر في الترمينال بس التطبيق بيقول منتهي/غير صالح».
 *
 * التشخيص الحي أثبت إن التحقق نفسه سليم؛ اللي كان ناقص إن السيرفر مكانش بيفرّق بين «مفيش كود
 * صالح أصلاً» (المستخدم لازم يطلب واحد جديد) و«الكود غلط» (يراجع الأرقام) — رسالة واحدة مبهمة
 * للاتنين، فالمستخدم مكانش يعرف يعمل إيه. الاختبارات دي بتثبّت الفرق ده وبتقفل السيناريوهات
 * الأربعة اللي بتطلّع بالظبط شكوى المالك.
 */
describe('OTP failure diagnostics (§106, real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: AuthService;

  const seed = String(Date.now()).slice(-8);
  const phones = Array.from({ length: 6 }, (_, index) => `+2010${seed}${index}`);

  const config = {
    get: (key: string) => {
      const values: Record<string, unknown> = {
        nodeEnv: 'test',
        'otp.expiryMinutes': 5,
        'otp.maxAttempts': 5,
        'jwt.accessSecret': 'test-access-secret-0123456789',
        'jwt.accessExpiresIn': '15m',
        'jwt.refreshSecret': 'test-refresh-secret-0123456789',
        'jwt.refreshExpiresIn': '30d',
      };
      return values[key];
    },
  } as ConfigService;

  async function insertOtp(
    phoneNumber: string,
    code: string,
    purpose: OtpPurpose,
    expiresAt = new Date(Date.now() + 300_000),
  ): Promise<void> {
    await dataSource.getRepository(OtpCode).save({
      phoneNumber,
      codeHash: await bcrypt.hash(code, 4),
      purpose,
      attemptsCount: 0,
      maxAttempts: 5,
      isUsed: false,
      expiresAt,
      requestIp: null,
    });
  }

  async function insertUser(phoneNumber: string): Promise<User> {
    return dataSource.getRepository(User).save({
      phoneNumber,
      phoneVerifiedAt: new Date(),
      fullName: `OTP diagnostics ${phoneNumber}`,
      userType: UserType.CUSTOMER,
      preferredLanguage: 'ar',
      isActive: true,
      isBlocked: false,
    });
  }

  async function loginError(phoneNumber: string, code: string): Promise<{ code: string; message: string }> {
    try {
      await service.login({ phone_number: phoneNumber, otp_code: code }, null);
      throw new Error('المفروض الدخول يفشل هنا');
    } catch (err) {
      const failure = err as { code?: string; message: string };
      return { code: failure.code ?? 'UNKNOWN', message: failure.message };
    }
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, OtpCode, RefreshToken, CustomerProfile, TechnicianProfile, Wallet],
    });
    await dataSource.initialize();

    service = new AuthService(
      dataSource.getRepository(User),
      dataSource.getRepository(OtpCode),
      dataSource.getRepository(RefreshToken),
      dataSource.getRepository(Wallet),
      dataSource,
      new JwtService(),
      config,
      { emit: jest.fn() } as never,
      { send: jest.fn().mockResolvedValue({ delivered: false, failureReason: 'test' }) } as never,
      { userRequiresMfa: jest.fn().mockResolvedValue(false) } as never,
      { hasAnyCredential: jest.fn().mockResolvedValue(false) } as never,
      { routeToRole: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const users = await dataSource.getRepository(User).find({ where: phones.map((phoneNumber) => ({ phoneNumber })) });
    const userIds = users.map((user) => user.id);
    if (userIds.length > 0) {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await dataSource.query(`DELETE FROM wallets WHERE owner_user_id = ANY($1::uuid[])`, [userIds]);
      await dataSource.query(`DELETE FROM customer_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    }
    await dataSource.query(`DELETE FROM otp_codes WHERE phone_number = ANY($1::text[])`, [phones]);
    await dataSource.destroy();
  });

  it('يقول «اطلب كود جديد» لما مفيش كود صالح أصلاً، مش «الكود غلط»', async () => {
    const phone = phones[0];
    await insertUser(phone);

    const failure = await loginError(phone, '123456');

    expect(failure.code).toBe('AUTH_003');
    expect(failure.message).toContain('ابعت الكود تاني');
    expect(failure.message).not.toContain('غلط');
  });

  it('يقول «اطلب كود جديد» لما الكود منتهي الصلاحية حتى لو الأرقام مظبوطة', async () => {
    const phone = phones[1];
    await insertUser(phone);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN, new Date(Date.now() - 1_000));

    const failure = await loginError(phone, '123456');

    expect(failure.code).toBe('AUTH_003');
    expect(failure.message).toContain('ابعت الكود تاني');
  });

  it('يقول «الكود غلط» + المحاولات الفاضلة، والعدّاد بيقل فعليًا', async () => {
    const phone = phones[2];
    await insertUser(phone);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN);

    const first = await loginError(phone, '000000');
    expect(first.code).toBe('AUTH_003');
    expect(first.message).toContain('غلط');
    expect(first.message).toContain('4');

    const second = await loginError(phone, '000000');
    expect(second.message).toContain('3');
  });

  // السيناريو اللي بلّغ عنه المالك حرفيًا: ضغط «ابعت كود» مرتين ودخّل كود السطر الأول من اللوج.
  it('الكود الأقدم بيترفض بعد إصدار كود جديد، ورسالته بتقول اطلب كود جديد', async () => {
    const phone = phones[3];
    await insertUser(phone);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: phone, purpose: OtpPurpose.LOGIN }, null);
    const firstCode = String(logSpy.mock.calls.at(-1)![0]).split('→').pop()!.trim();
    await service.requestOtp({ phone_number: phone, purpose: OtpPurpose.LOGIN }, null);
    const secondCode = String(logSpy.mock.calls.at(-1)![0]).split('→').pop()!.trim();
    logSpy.mockRestore();

    expect(firstCode).toMatch(/^\d{6}$/);
    expect(secondCode).toMatch(/^\d{6}$/);
    expect(firstCode).not.toBe(secondCode);

    // الرسالة لازم تقول السبب الحقيقي: الكود ده اتلغى، مش «غلط» (المالك شايفه قدامه في الترمينال).
    const failure = await loginError(phone, firstCode);
    expect(failure.code).toBe('AUTH_003');
    expect(failure.message).toContain('اتلغى');

    // والكود الأحدث لسه شغال — الرفض كان للأقدم بس، مش للاتنين.
    await expect(service.login({ phone_number: phone, otp_code: secondCode }, null)).resolves.toBeDefined();
  });

  // كود اتصدر لغرض مختلف (تسجيل) ما ينفعش في الدخول — تاني أشيع سبب لنفس الشكوى.
  it('كود التسجيل مش بيشتغل في مسار الدخول', async () => {
    const phone = phones[4];
    await insertUser(phone);
    await insertOtp(phone, '654321', OtpPurpose.REGISTER);

    const failure = await loginError(phone, '654321');

    expect(failure.code).toBe('AUTH_003');
    expect(failure.message).toContain('ابعت الكود تاني');
    // الكود بتاع التسجيل لازم يفضل سليم — مسار الدخول ما يستهلكش كود غرض تاني.
    const otp = await dataSource.getRepository(OtpCode).findOneByOrFail({ phoneNumber: phone, purpose: OtpPurpose.REGISTER });
    expect(otp.isUsed).toBe(false);
    expect(otp.attemptsCount).toBe(0);
  });

  // سطر لوج التطوير هو المصدر الوحيد للكود محليًا — شكله عقد فعلي مع كل سكريبتات test_live.
  it('سطر اللوج بيفضل منتهي بالكود بعد «→» ومعاه وقت انتهاء الصلاحية', async () => {
    const phone = phones[5];
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: phone, purpose: OtpPurpose.LOGIN }, null);
    const line = String(logSpy.mock.calls.at(-1)![0]);
    logSpy.mockRestore();

    expect(line.split('→').pop()!.trim()).toMatch(/^\d{6}$/);
    expect(line).toContain('صالح لحد');
    expect(line).toContain('بيلغي أي كود أقدم');
  });
});
