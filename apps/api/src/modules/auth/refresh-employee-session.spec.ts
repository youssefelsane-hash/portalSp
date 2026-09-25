import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { AccountRolesService } from './account-roles.service';
import { UserRoleGrant } from './entities/user-role-grant.entity';

/**
 * **بَقّة حقيقية اتلقطت في متصفح حقيقي (2026-09-25)** — كل جلسة أدمن كانت بتموت عند أول تدوير.
 *
 * `refresh()` كانت بتتحقق من الدور النشط بـ`user_role_grants` لكل الحسابات. بس `grantRole`
 * **بترفض** حسابات الموظفين صراحةً (ADR-0110 §3)، فالجدول ده مالوش ولا صف لأي أدمن — يعني
 * الفحص كان بيرجّع `[]` دايمًا ويرمي «سجّل دخول تاني». النتيجة اللي اتشافت: الأدمن بيدخل تمام،
 * وأول إعادة تحميل كاملة للصفحة (أو بعد ١٥ دقيقة) الجلسة بتسقط، **واللوحة بتفضل مفتوحة
 * بصلاحيات صفر** — قايمة جانبية شبه فاضية و«ماعندكش صلاحية» في كل شاشة.
 *
 * `refresh-token-rotation.spec.ts` ماكانتش بتمسكها لأنها بتدخل صف بلا `active_role` خالص،
 * فالفرع ده ماكانش بيتنفّذ أصلاً. الاختبار ده بيدخل الصف **بدور نشط** — وده الشرط اللي بيفرّق.
 */
describe('AuthService.refresh() — جلسة الموظف بتعيش بعد التدوير (regression 2026-09-25)', () => {
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
      entities: [User, RefreshToken, Wallet, UserRoleGrant],
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
      dataSource.getRepository(Wallet),
      dataSource,
      new JwtService(),
      configStub,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      // ADR-0109 — `auth.login_method`. الـspecs دي مكتوبة على مسار الـOTP، فالـstub
      // بيرجّع 'otp' عشان سلوكها يفضل زي ما هو بالحرف.
      { getString: async () => 'otp' } as never,
      // ADR-0110 — خدمة حقيقية على نفس الـdataSource: مسار التسجيل بيمنح دور فعلاً، وstub
      // فاضي كان هيخلي الاختبار يعدّي على حساب بلا منحة (وهو حساب مايعرفش يدخل تاني).
      new AccountRolesService(dataSource.getRepository(UserRoleGrant), dataSource),
    );


    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [user] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2013${runId}`.slice(0, 15), `اختبار تدوير جلسة موظف ${runId}`],
    );
    userId = user.id;

    rawToken = `${runId}-employee-session-rotation-token`;
    await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, is_revoked, expires_at, active_role)
       VALUES ($1,$2,false, now() + interval '30 days', 'admin')`,
      [userId, hashRefreshToken(rawToken)],
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    await q(`DELETE FROM users WHERE id = $1`, [userId]);
    await dataSource.destroy();
  });

  it('أدمن بدور نشط في الجلسة ومفيش أي صف في user_role_grants — التدوير بينجح', async () => {
    // الشرط اللي البَقّة كانت قايمة عليه: الجدول فاضي تمامًا للحساب ده، وده الوضع الطبيعي
    // لكل الموظفين مش حالة حدّية.
    const grants = await dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS count FROM user_role_grants WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    expect(Number(grants[0].count)).toBe(0);

    const tokens = await service.refresh(rawToken, null);
    expect(tokens.access_token).toBeTruthy();

    // والجلسة الجديدة بتفضل شايلة نفس الدور — مش بترجع بلا دور فتفقد صلاحياتها بهدوء.
    const [row] = await dataSource.query<{ active_role: string }[]>(
      `SELECT active_role FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false`,
      [userId],
    );
    expect(row.active_role).toBe('admin');
  });

  it('اتغيّر `user_type` بتاع الحساب — الجلسة بتسقط (الضمانة الأمنية محفوظة)', async () => {
    const [current] = await dataSource.query<{ token_hash: string }[]>(
      `SELECT token_hash FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false`,
      [userId],
    );
    expect(current).toBeTruthy();

    // نحوّل الحساب لنوع تاني ونجرّب ندوّر بالتوكن الجديد — لازم يترفض.
    const fresh = `${runId}-employee-session-after-type-change`;
    await dataSource.query(
      `UPDATE refresh_tokens SET token_hash = $2 WHERE user_id = $1 AND is_revoked = false`,
      [userId, hashRefreshToken(fresh)],
    );
    await dataSource.query(`UPDATE users SET user_type = 'partner' WHERE id = $1`, [userId]);

    await expect(service.refresh(fresh, null)).rejects.toMatchObject({ code: 'AUTH_001' });

    await dataSource.query(`UPDATE users SET user_type = 'admin' WHERE id = $1`, [userId]);
  });
});
