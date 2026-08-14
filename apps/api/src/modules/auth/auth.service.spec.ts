import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { TwilioSmsDispatcher } from '../../common/notifications/twilio-sms-dispatcher.service';
import { AuthService } from './auth.service';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User, UserType } from './entities/user.entity';
import { MfaPolicyService } from './mfa-policy.service';
import { NotificationRoutingService } from '../notifications/notification-routing.service';
import { WebAuthnService } from './webauthn.service';

// ريبوزيتوري وهمي في الذاكرة بديل TypeORM — كفاية عشان نختبر منطق auth.service لوحده
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

  async findOne({ where }: { where: Partial<T>; order?: unknown }): Promise<T | null> {
    const entries = Object.entries(where) as [keyof T, unknown][];
    const matches = this.rows.filter((row) => entries.every(([key, value]) => row[key] === value));
    return matches[matches.length - 1] ?? null;
  }

  async update(where: Partial<T>, patch: Partial<T>): Promise<void> {
    const entries = Object.entries(where) as [keyof T, unknown][];
    this.rows
      .filter((row) => entries.every(([key, value]) => row[key] === value))
      .forEach((row) => Object.assign(row, patch));
  }

  async delete(): Promise<{ affected: number }> {
    return { affected: 0 };
  }

  async softDelete(): Promise<void> {
    // no-op كفاية للاختبار
  }
}

// DataSource وهمية — refresh() (P0-5) بقت بتستخدم transaction()/pessimistic_write حقيقي، فمحتاجة
// manager يقدر يخدم نفس النداءات (createQueryBuilder/update/findOne/save/getRepository) بالظبط
// اللي auth.service.ts بينادّيها. مش محاكاة TypeORM عامة — مبنية على نفس نداءات الكود الفعلي بس،
// زي فلسفة FakeRepository فوق بالحرف.
function createFakeDataSource(users: FakeRepository<User>, refreshTokens: FakeRepository<RefreshToken>): DataSource {
  const manager = {
    createQueryBuilder: (entity: unknown) => {
      let whereParams: Record<string, unknown> = {};
      const qb = {
        setLock: () => qb,
        where: (_cond: string, params: Record<string, unknown>) => {
          whereParams = params;
          return qb;
        },
        getOne: async () => {
          if (entity !== RefreshToken) return null;
          return refreshTokens.rows.find((r) => r.tokenHash === whereParams.tokenHash) ?? null;
        },
      };
      return qb;
    },
    update: async (entity: unknown, where: Record<string, unknown>, patch: Record<string, unknown>) => {
      if (entity === RefreshToken) await refreshTokens.update(where as Partial<RefreshToken>, patch as Partial<RefreshToken>);
    },
    findOne: async (entity: unknown, options: { where: Record<string, unknown> }) => {
      if (entity === User) return users.findOne(options as { where: Partial<User> });
      return null;
    },
    save: async (entity: RefreshToken) => refreshTokens.save(entity),
    getRepository: (entity: unknown) => (entity === RefreshToken ? refreshTokens : users),
  };
  return { transaction: async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager) } as unknown as DataSource;
}

describe('AuthService', () => {
  let service: AuthService;
  let users: FakeRepository<User>;
  let otpCodes: FakeRepository<OtpCode>;
  let refreshTokens: FakeRepository<RefreshToken>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    users = new FakeRepository<User>();
    otpCodes = new FakeRepository<OtpCode>();
    refreshTokens = new FakeRepository<RefreshToken>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        TwilioSmsDispatcher,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const values: Record<string, unknown> = {
                'otp.expiryMinutes': 5,
                'otp.maxAttempts': 5,
                'jwt.accessSecret': 'test-access-secret-0123456789',
                'jwt.accessExpiresIn': '15m',
                'jwt.refreshSecret': 'test-refresh-secret-0123456789',
                'jwt.refreshExpiresIn': '30d',
              };
              return values[key];
            },
          },
        },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(OtpCode), useValue: otpCodes },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshTokens },
        { provide: DataSource, useValue: createFakeDataSource(users, refreshTokens) },
        // MFA (ADR-0011) — الاختبارات هنا كلها لحسابات عادية (مش High-Privilege)، فـ
        // userRequiresMfa بترجع false دايمًا وlogin() بيكمل مسار OTP العادي القديم زي ما هو.
        { provide: MfaPolicyService, useValue: { userRequiresMfa: jest.fn().mockResolvedValue(false) } },
        { provide: WebAuthnService, useValue: { hasAnyCredential: jest.fn().mockResolvedValue(false) } },
        { provide: NotificationRoutingService, useValue: { routeToRole: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('يسجل مستخدم جديد بعد التحقق من كود OTP صحيح، ويرجّع access + refresh token', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await service.requestOtp({ phone_number: '+201001234567', purpose: OtpPurpose.REGISTER }, '127.0.0.1');
    const code = String(logSpy.mock.calls[0][0]).split('→ ').pop()!.trim();
    logSpy.mockRestore();

    const tokens = await service.register(
      { phone_number: '+201001234567', otp_code: code, full_name: 'يوسف الصان', user_type: UserType.CUSTOMER },
      '127.0.0.1',
    );

    expect(tokens.access_token).toEqual(expect.any(String));
    expect(tokens.refresh_token).toHaveLength(96); // 48 بايت hex
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0].phoneNumber).toBe('+201001234567');
  });

  it('يرفض كود OTP غلط بخطأ AUTH_003', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: '+201001234567', purpose: OtpPurpose.REGISTER }, null);

    await expect(
      service.register(
        { phone_number: '+201001234567', otp_code: '000000', full_name: 'اسم', user_type: UserType.CUSTOMER },
        null,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_003 });
  });

  it('يقفل بعد تجاوز عدد المحاولات المسموح بخطأ AUTH_004', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: '+201001234567', purpose: OtpPurpose.REGISTER }, null);
    logSpy.mockRestore();

    for (let i = 0; i < 5; i++) {
      await expect(
        service.register(
          { phone_number: '+201001234567', otp_code: '000000', full_name: 'اسم', user_type: UserType.CUSTOMER },
          null,
        ),
      ).rejects.toBeInstanceOf(ApiException);
    }

    await expect(
      service.register(
        { phone_number: '+201001234567', otp_code: '000000', full_name: 'اسم', user_type: UserType.CUSTOMER },
        null,
      ),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_004 });
  });

  it('بيدوّر الـ refresh token: القديم يتلغي فور استخدامه ومينفعش يتستخدم تاني', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: '+201001234567', purpose: OtpPurpose.REGISTER }, null);
    const code = logSpy.mock.calls[0][0].split('→ ').pop()!.trim();
    logSpy.mockRestore();

    const firstTokens = await service.register(
      { phone_number: '+201001234567', otp_code: code, full_name: 'اسم', user_type: UserType.CUSTOMER },
      null,
    );

    const rotated = await service.refresh(firstTokens.refresh_token, null);
    expect(rotated.refresh_token).not.toBe(firstTokens.refresh_token);

    await expect(service.refresh(firstTokens.refresh_token, null)).rejects.toMatchObject({
      code: ErrorCode.AUTH_001,
    });
  });

  // بَقّة أمنية حقيقية اتصلحت (مراجعة أمان شاملة 2026-08-13، P0-4): requestOtp() كانت بتسجّل
  // الكود الفعلي في اللوج دايمًا بلا شرط — خطر حقيقي في Production. الاختبار ده بيبني نسخة
  // منفصلة من AuthService بـNODE_ENV=production عشان يثبت الكود مبقاش بيتسجّل خالص.
  it('في Production مايتسجلش كود OTP الفعلي في اللوج خالص — كان الثغرة', async () => {
    const prodUsers = new FakeRepository<User>();
    const prodRefreshTokens = new FakeRepository<RefreshToken>();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        TwilioSmsDispatcher,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const values: Record<string, unknown> = {
                nodeEnv: 'production',
                'otp.expiryMinutes': 5,
                'otp.maxAttempts': 5,
                'jwt.accessSecret': 'test-access-secret-0123456789',
                'jwt.accessExpiresIn': '15m',
                'jwt.refreshSecret': 'test-refresh-secret-0123456789',
                'jwt.refreshExpiresIn': '30d',
              };
              return values[key];
            },
          },
        },
        { provide: getRepositoryToken(User), useValue: prodUsers },
        { provide: getRepositoryToken(OtpCode), useValue: new FakeRepository<OtpCode>() },
        { provide: getRepositoryToken(RefreshToken), useValue: prodRefreshTokens },
        { provide: DataSource, useValue: createFakeDataSource(prodUsers, prodRefreshTokens) },
        { provide: MfaPolicyService, useValue: { userRequiresMfa: jest.fn().mockResolvedValue(false) } },
        { provide: WebAuthnService, useValue: { hasAnyCredential: jest.fn().mockResolvedValue(false) } },
        { provide: NotificationRoutingService, useValue: { routeToRole: jest.fn() } },
      ],
    }).compile();
    const prodService = moduleRef.get(AuthService);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await prodService.requestOtp({ phone_number: '+201001234567', purpose: OtpPurpose.REGISTER }, null);
    const loggedWithRawCode = logSpy.mock.calls.some((call) => /\[OTP\].*→\s*\d{6}/.test(String(call[0])));
    logSpy.mockRestore();

    expect(loggedWithRawCode).toBe(false);
  });
});
