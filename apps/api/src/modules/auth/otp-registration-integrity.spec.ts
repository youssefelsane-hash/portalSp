import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { DomesticWorkerProfile } from '../domestic-workers/entities/domestic-worker-profile.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { OtpCode, OtpPurpose } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User, UserType } from './entities/user.entity';

describe('Auth OTP and registration integrity (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: AuthService;

  const seed = String(Date.now()).slice(-8);
  const phones = Array.from({ length: 10 }, (_, index) => `+201${seed}${index}`);

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
    maxAttempts = 5,
    expiresAt = new Date(Date.now() + 300_000),
  ): Promise<void> {
    await dataSource.getRepository(OtpCode).save({
      phoneNumber,
      codeHash: await bcrypt.hash(code, 4),
      purpose,
      attemptsCount: 0,
      maxAttempts,
      isUsed: false,
      expiresAt,
      requestIp: null,
    });
  }

  async function insertUser(phoneNumber: string, active = true): Promise<User> {
    return dataSource.getRepository(User).save({
      phoneNumber,
      phoneVerifiedAt: new Date(),
      fullName: `Auth integrity ${phoneNumber}`,
      userType: UserType.CUSTOMER,
      preferredLanguage: 'ar',
      isActive: active,
      isBlocked: false,
    });
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, OtpCode, RefreshToken, CustomerProfile, TechnicianProfile, DomesticWorkerProfile, Wallet],
    });
    await dataSource.initialize();

    service = new AuthService(
      dataSource.getRepository(User),
      dataSource.getRepository(OtpCode),
      dataSource.getRepository(RefreshToken),
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
      await dataSource.query(`DELETE FROM technician_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await dataSource.query(`DELETE FROM domestic_worker_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    }
    await dataSource.query(`DELETE FROM otp_codes WHERE phone_number = ANY($1::text[])`, [phones]);
    await dataSource.destroy();
  });

  it('allows exactly one concurrent login with the same OTP', async () => {
    const phone = phones[0];
    const user = await insertUser(phone);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN);

    const results = await Promise.allSettled([
      service.login({ phone_number: phone, otp_code: '123456' }, null),
      service.login({ phone_number: phone, otp_code: '123456' }, null),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await dataSource.getRepository(RefreshToken).count({ where: { userId: user.id } })).toBe(1);
  });

  it('serializes wrong attempts without exceeding the attempt limit', async () => {
    const phone = phones[1];
    await insertUser(phone);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN, 1);

    const results = await Promise.allSettled([
      service.login({ phone_number: phone, otp_code: '000000' }, null),
      service.login({ phone_number: phone, otp_code: '000000' }, null),
    ]);
    const otp = await dataSource.getRepository(OtpCode).findOneByOrFail({ phoneNumber: phone, purpose: OtpPurpose.LOGIN });

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(otp.attemptsCount).toBe(1);
    expect(results.some((result) => result.status === 'rejected' && result.reason?.code === 'AUTH_004')).toBe(true);
  });

  it('invalidates older unused codes when a replacement is requested', async () => {
    const phone = phones[2];
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await service.requestOtp({ phone_number: phone, purpose: OtpPurpose.REGISTER }, null);
    await service.requestOtp({ phone_number: phone, purpose: OtpPurpose.REGISTER }, null);
    log.mockRestore();

    const rows = await dataSource.getRepository(OtpCode).find({
      where: { phoneNumber: phone, purpose: OtpPurpose.REGISTER },
      order: { createdAt: 'ASC' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.isUsed)).toEqual([true, false]);
  });

  it('keeps one latest challenge across concurrent resend and verification', async () => {
    const phone = phones[7];
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await Promise.all([
      service.requestOtp({ phone_number: phone, purpose: OtpPurpose.REGISTER }, null),
      service.requestOtp({ phone_number: phone, purpose: OtpPurpose.REGISTER }, null),
    ]);
    const codes = log.mock.calls.map((call) => String(call[0]).split('→ ').at(-1)!.trim());
    log.mockRestore();

    const results = await Promise.allSettled(
      codes.map((otp_code) =>
        service.register({ phone_number: phone, otp_code, full_name: 'Concurrent resend', user_type: UserType.CUSTOMER }, null),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await dataSource.getRepository(User).count({ where: { phoneNumber: phone } })).toBe(1);
    expect(await dataSource.getRepository(OtpCode).count({ where: { phoneNumber: phone, isUsed: false } })).toBe(0);
  });

  it('rejects an expired OTP without issuing a session', async () => {
    const phone = phones[8];
    const user = await insertUser(phone);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN, 5, new Date(Date.now() - 1_000));

    await expect(service.login({ phone_number: phone, otp_code: '123456' }, null)).rejects.toMatchObject({
      code: 'AUTH_003',
    });
    expect(await dataSource.getRepository(RefreshToken).count({ where: { userId: user.id } })).toBe(0);
  });

  it('rolls back OTP, user, profile, wallet, and session together when baseline provisioning fails', async () => {
    const phone = phones[3];
    await insertOtp(phone, '123456', OtpPurpose.REGISTER);
    const provision = jest.spyOn(service as any, 'provisionAccountBaseline') as jest.SpyInstance<Promise<void>>;
    provision.mockRejectedValueOnce(new Error('injected baseline failure'));

    await expect(
      service.register(
        { phone_number: phone, otp_code: '123456', full_name: 'Atomic customer', user_type: UserType.CUSTOMER },
        null,
      ),
    ).rejects.toThrow('injected baseline failure');
    provision.mockRestore();

    expect(await dataSource.getRepository(User).count({ where: { phoneNumber: phone } })).toBe(0);
    expect(await dataSource.getRepository(OtpCode).findOneByOrFail({ phoneNumber: phone })).toMatchObject({ isUsed: false });

    await service.register(
      { phone_number: phone, otp_code: '123456', full_name: 'Atomic customer', user_type: UserType.CUSTOMER },
      null,
    );
    const user = await dataSource.getRepository(User).findOneByOrFail({ phoneNumber: phone });
    expect(await dataSource.getRepository(CustomerProfile).count({ where: { userId: user.id } })).toBe(1);
    expect(await dataSource.getRepository(Wallet).count({ where: { ownerUserId: user.id } })).toBe(1);
    expect(await dataSource.getRepository(RefreshToken).count({ where: { userId: user.id } })).toBe(1);
  });

  it.each([
    [UserType.TECHNICIAN, phones[4], TechnicianProfile],
    [UserType.DOMESTIC_WORKER, phones[5], DomesticWorkerProfile],
  ] as const)('creates the required profile and wallet atomically for %s registration', async (userType, phone, profile) => {
    await insertOtp(phone, '123456', OtpPurpose.REGISTER);
    await service.register({ phone_number: phone, otp_code: '123456', full_name: `Atomic ${userType}`, user_type: userType }, null);
    const user = await dataSource.getRepository(User).findOneByOrFail({ phoneNumber: phone });

    expect(await dataSource.getRepository(profile).count({ where: { userId: user.id } })).toBe(1);
    expect(await dataSource.getRepository(Wallet).count({ where: { ownerUserId: user.id } })).toBe(1);
  });

  it('never issues a session for an inactive account', async () => {
    const phone = phones[6];
    await insertUser(phone, false);
    await insertOtp(phone, '123456', OtpPurpose.LOGIN);

    await expect(service.login({ phone_number: phone, otp_code: '123456' }, null)).rejects.toMatchObject({
      code: 'AUTH_001',
    });
    const user = await dataSource.getRepository(User).findOneByOrFail({ phoneNumber: phone });
    expect(await dataSource.getRepository(RefreshToken).count({ where: { userId: user.id } })).toBe(0);

    await expect(service.passwordlessLogin(user.id, null)).rejects.toMatchObject({ code: 'AUTH_001' });
    await expect(service.completeMfaLogin(user.id, null)).rejects.toMatchObject({ code: 'AUTH_001' });

    const rawToken = `inactive-${seed}`;
    await dataSource.getRepository(RefreshToken).save({
      userId: user.id,
      tokenHash: createHash('sha256').update(rawToken).digest('hex'),
      amr: ['otp'],
      isRevoked: false,
      expiresAt: new Date(Date.now() + 300_000),
    });
    await expect(service.refresh(rawToken, null)).rejects.toMatchObject({ code: 'AUTH_001' });
  });
});
