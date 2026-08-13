import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from './entities/user.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح بَقّة أمنية حقيقية كانت موثّقة صراحة في
// admin/README.md (مراجعة أمان شاملة 2026-08-13، بند P0-6 في docs/12): JwtStrategy.validate()
// كانت بترجّع الـpayload بلا أي فحص قاعدة بيانات — حظر/حذف حساب مكانش بياخد مفعوله على
// access token لسه ساري إلا بعد ما ينتهي (أقصى مدة 15 دقيقة).
describe('JwtStrategy.validate() — حظر/تعطيل/حذف الحساب يبطل الـaccess token فورًا (regression P0-6)', () => {
  let dataSource: DataSource;
  let strategy: JwtStrategy;

  const runId = Date.now().toString(36);
  const ids = { activeUser: '', blockedUser: '', inactiveUser: '', deletedUser: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User],
    });
    await dataSource.initialize();

    const configStub = {
      get: (key: string) => (key === 'jwt.accessSecret' ? 'test-access-secret-0123456789' : undefined),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(configStub, dataSource.getRepository(User));

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const mk = async (label: string, extraCols: string, extraVals: unknown[]) => {
      const [row] = await q(
        `INSERT INTO users (phone_number, full_name, user_type${extraCols}) VALUES ($1,$2,'customer'${extraVals.map((_, i) => `,$${i + 3}`).join('')}) RETURNING id`,
        [`+2013${runId}${label}`.slice(0, 15), `اختبار ${label} ${runId}`, ...extraVals],
      );
      return row.id as string;
    };

    ids.activeUser = await mk('active', '', []);
    ids.blockedUser = await mk('blocked', ', is_blocked, blocked_reason', [true, 'اختبار']);
    ids.inactiveUser = await mk('inactive', ', is_active', [false]);
    ids.deletedUser = await mk('deleted', ', deleted_at', [new Date()]);
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(ids)]);
    await dataSource.destroy();
  });

  it('مستخدم نشط عادي: validate() بتعدّي وترجّع الـpayload زي ما هو', async () => {
    const result = await strategy.validate({ sub: ids.activeUser, userType: 'customer' } as never);
    expect(result).toMatchObject({ sub: ids.activeUser });
  });

  it('مستخدم محظور (is_blocked=true): validate() ترفض فورًا — كان الثغرة', async () => {
    await expect(strategy.validate({ sub: ids.blockedUser, userType: 'customer' } as never)).rejects.toThrow();
  });

  it('مستخدم معطّل (is_active=false): validate() ترفض فورًا', async () => {
    await expect(strategy.validate({ sub: ids.inactiveUser, userType: 'customer' } as never)).rejects.toThrow();
  });

  it('مستخدم محذوف (soft-deleted): validate() ترفض فورًا', async () => {
    await expect(strategy.validate({ sub: ids.deletedUser, userType: 'customer' } as never)).rejects.toThrow();
  });

  it('sub لمستخدم مش موجود خالص: validate() ترفض بأمان (مش استثناء غير متوقّع)', async () => {
    await expect(strategy.validate({ sub: '00000000-0000-0000-0000-000000000000', userType: 'customer' } as never)).rejects.toThrow();
  });
});
