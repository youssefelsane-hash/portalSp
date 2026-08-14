import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

// اختبار حي ضد Postgres حقيقي (نفس فلسفة matching.service.spec.ts/permissions.service.spec.ts) —
// بيثبت إصلاح بَقّة أمنية حقيقية (مراجعة أمان شاملة 2026-08-13، بند P0-5 في docs/12): refresh()
// كانت بتقرأ صف الـrefresh_tokens بـfindOne عادي (من غير قفل)، تفحصه، وتكتب بعد كده — بلا
// transaction ولا SELECT ... FOR UPDATE. طلبين refresh() متزامنين فعليًا بنفس التوكن تحت
// READ COMMITTED كانوا الاتنين يقدروا يعدّوا ويصدروا زوج توكنز صالح لكل واحد — الاختبار ده بيثبت
// إن الإصلاح (pessimistic_write جوّه transaction) بيمنع ده فعليًا، مش نظريًا، ضد قفل DB حقيقي —
// اختبار الـFakeRepository في auth.service.spec.ts مايقدرش يثبت ده لأنه مش عنده قفل صفوف حقيقي.
describe('AuthService.refresh() — تدوير refresh token ذرّي تحت تزامن حقيقي (regression P0-5)', () => {
  let dataSource: DataSource;
  let service: AuthService;

  const runId = Date.now().toString(36);
  let userId = '';
  let rawToken = '';

  const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, RefreshToken],
    });
    await dataSource.initialize();

    const configStub = {
      get: (key: string) => {
        const values: Record<string, unknown> = {
          nodeEnv: 'test',
          'jwt.accessSecret': 'test-access-secret-0123456789',
          'jwt.accessExpiresIn': '15m',
          'jwt.refreshSecret': 'test-refresh-secret-0123456789',
          'jwt.refreshExpiresIn': '30d',
        };
        return values[key];
      },
    } as unknown as ConfigService;

    service = new AuthService(
      dataSource.getRepository(User),
      {} as never,
      dataSource.getRepository(RefreshToken),
      dataSource,
      new JwtService(),
      configStub,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2012${runId}`.slice(0, 15), `اختبار تدوير توكن ${runId}`],
    );
    userId = user.id;

    rawToken = `${runId}-raw-refresh-token-value-for-concurrency-test`;
    await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, is_revoked, expires_at) VALUES ($1,$2,false, now() + interval '30 days')`,
      [userId, hashRefreshToken(rawToken)],
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM users WHERE id = $1`, [userId]);
    await dataSource.destroy();
  });

  it('نداءين refresh() متزامنين فعليًا بنفس التوكن — واحد بس ينجح، التاني يترفض بأمان', async () => {
    const results = await Promise.allSettled([service.refresh(rawToken, null), service.refresh(rawToken, null)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'AUTH_001' });

    // الإثبات القاطع: صف واحد بس غير ملغي (is_revoked=false) لنفس المستخدم في النهاية —
    // مش زوج جلستين صالحتين من نفس التوكن (السلوك القديم قبل الإصلاح).
    const activeRows = await dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false`,
      [userId],
    );
    expect(Number(activeRows[0].count)).toBe(1);
  });
});
