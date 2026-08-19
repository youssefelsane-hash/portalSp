import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

/**
 * Script 7 Phase 1 — إدارة الحساب الذاتية (GET/PATCH/DELETE /auth/me، POST /auth/logout،
 * GET /auth/sessions، DELETE /auth/sessions/:id) كانت **مالهاش أي اختبار خالص** رغم إنها
 * endpoints حساسة (تعديل بروفايل، حذف حساب، إدارة جلسات). الاختبار ده بيثبت الـinvariants
 * الأساسية حيًا ضد Postgres حقيقي:
 * - updateMe() محدود بـwhitelist صريح (UpdateMeDto) — مينفعش يغيّر phone_number/user_type.
 * - deleteMe() بتلغي كل الجلسات + soft-delete، وحساب محذوف مايقدرش يستخدم أي جلسة قديمة تاني.
 * - logout() بيلغي جلسة واحدة بس (الجهاز ده)، باقي أجهزة المستخدم فاضلة شغالة (مش logout عالمي).
 * - listSessions()/revokeSession() محصورين بصاحب الجلسة بس — مستخدم تاني مايقدرش يشوف أو يلغي
 *   جلسة مش بتاعته (IDOR)، حتى لو عرف الـsession id بالظبط.
 */
describe('AuthService — إدارة الحساب الذاتية (Script 7 Phase 1)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: AuthService;
  const runId = Date.now().toString(36);
  const ids = { userA: '', userB: '', sessionA1: '', sessionA2: '', sessionB1: '' };

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
    const [userA] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at, preferred_language)
       VALUES ($1,$2,'customer',now(),'ar') RETURNING id`,
      [`+2013${runId}`.slice(0, 15), `عميل A ${runId}`],
    );
    ids.userA = userA.id;
    const [userB] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at, preferred_language)
       VALUES ($1,$2,'customer',now(),'ar') RETURNING id`,
      [`+2014${runId}`.slice(0, 15), `عميل B ${runId}`],
    );
    ids.userB = userB.id;

    // مستخدم A عنده جهازين (جلستين)، مستخدم B عنده جهاز واحد.
    const [sessionA1] = await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_name, is_revoked, expires_at)
       VALUES ($1,$2,'جهاز A1',false, now() + interval '30 days') RETURNING id`,
      [ids.userA, hashRefreshToken(`${runId}-a1`)],
    );
    ids.sessionA1 = sessionA1.id;
    const [sessionA2] = await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_name, is_revoked, expires_at)
       VALUES ($1,$2,'جهاز A2',false, now() + interval '30 days') RETURNING id`,
      [ids.userA, hashRefreshToken(`${runId}-a2`)],
    );
    ids.sessionA2 = sessionA2.id;
    const [sessionB1] = await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_name, is_revoked, expires_at)
       VALUES ($1,$2,'جهاز B1',false, now() + interval '30 days') RETURNING id`,
      [ids.userB, hashRefreshToken(`${runId}-b1`)],
    );
    ids.sessionB1 = sessionB1.id;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id IN ($1,$2)`, [ids.userA, ids.userB]);
      await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.userA, ids.userB]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('updateMe(): بيحدّث الحقول المسموحة بس، وحقول تانية (phone_number/user_type) مش موجودة في الـDTO أصلاً فمش قابلة للتغيير عن الطريق ده', async () => {
    const updated = await service.updateMe(ids.userA, {
      full_name: 'اسم جديد بعد التعديل',
      avatar_url: 'https://example.com/new-avatar.png',
      preferred_language: 'en',
    });
    expect(updated.fullName).toBe('اسم جديد بعد التعديل');
    expect(updated.avatarUrl).toBe('https://example.com/new-avatar.png');
    expect(updated.preferredLanguage).toBe('en');

    const [row] = await dataSource.query<{ phone_number: string; user_type: string }[]>(
      `SELECT phone_number, user_type FROM users WHERE id = $1`,
      [ids.userA],
    );
    // رقم التليفون ونوع المستخدم فضلوا زي ما هم — مفيش مسار لتغييرهم عبر updateMe() خالص
    // (UpdateMeDto whitelist صريح: full_name/avatar_url/preferred_language بس).
    expect(row.phone_number).toBe(`+2013${runId}`.slice(0, 15));
    expect(row.user_type).toBe('customer');
  });

  it('getMe(): بيرجّع البروفايل المحدّث، وuser غير موجود يترفض بـAUTH_001', async () => {
    const me = await service.getMe(ids.userA);
    expect(me.fullName).toBe('اسم جديد بعد التعديل');

    await expect(service.getMe('00000000-0000-7000-8000-000000000999')).rejects.toMatchObject({ code: 'AUTH_001' });
  });

  it('logout(): بيلغي جلسة واحدة بس (الجهاز اللي بعت التوكن ده) — باقي أجهزة نفس المستخدم فاضلة شغالة', async () => {
    await service.logout(`${runId}-a1`);

    const [sessionA1Row] = await dataSource.query<{ is_revoked: boolean; revoked_reason: string }[]>(
      `SELECT is_revoked, revoked_reason FROM refresh_tokens WHERE id = $1`,
      [ids.sessionA1],
    );
    expect(sessionA1Row.is_revoked).toBe(true);
    expect(sessionA1Row.revoked_reason).toBe('logout');

    // الجهاز التاني بتاع نفس المستخدم (A2) لسه شغال — logout مش عملية عالمية على كل الأجهزة.
    const [sessionA2Row] = await dataSource.query<{ is_revoked: boolean }[]>(
      `SELECT is_revoked FROM refresh_tokens WHERE id = $1`,
      [ids.sessionA2],
    );
    expect(sessionA2Row.is_revoked).toBe(false);
  });

  it('listSessions(): بيرجّع جلسات صاحبها بس (النشطة)، مش جلسات مستخدم تاني', async () => {
    const sessionsA = await service.listSessions(ids.userA);
    // sessionA1 اتلغت في الاختبار اللي فات، فمفروض ما تظهرش (isRevoked: false بس في الفلتر).
    expect(sessionsA.map((s) => s.id)).toEqual([ids.sessionA2]);
    expect(sessionsA.some((s) => s.id === ids.sessionB1)).toBe(false);

    const sessionsB = await service.listSessions(ids.userB);
    expect(sessionsB.map((s) => s.id)).toEqual([ids.sessionB1]);
  });

  it('revokeSession(): مستخدم تاني مايقدرش يلغي جلسة مش بتاعته حتى لو عرف الـid بالظبط (IDOR) — 404 صريح', async () => {
    // مستخدم A بيحاول يلغي جلسة مستخدم B.
    await expect(service.revokeSession(ids.userA, ids.sessionB1)).rejects.toMatchObject({ code: 'VAL_001' });

    // جلسة B فضلت شغالة — محاولة الـIDOR الفاشلة ماأثّرتش عليها.
    const [sessionB1Row] = await dataSource.query<{ is_revoked: boolean }[]>(
      `SELECT is_revoked FROM refresh_tokens WHERE id = $1`,
      [ids.sessionB1],
    );
    expect(sessionB1Row.is_revoked).toBe(false);
  });

  it('revokeSession(): صاحب الجلسة الفعلي يقدر يلغيها عادي', async () => {
    await service.revokeSession(ids.userA, ids.sessionA2);
    const [row] = await dataSource.query<{ is_revoked: boolean; revoked_reason: string }[]>(
      `SELECT is_revoked, revoked_reason FROM refresh_tokens WHERE id = $1`,
      [ids.sessionA2],
    );
    expect(row.is_revoked).toBe(true);
    expect(row.revoked_reason).toBe('user_revoked');
  });

  it('deleteMe(): بتلغي كل جلسات المستخدم (revoke-all) + soft-delete + is_active=false — حساب محذوف مايقدرش يستخدم أي جلسة قديمة', async () => {
    // نرجّع جلسة B شغالة (كانت لسه شغالة أصلاً)، ونحذف حساب B بالكامل.
    await service.deleteMe(ids.userB);

    const [sessionB1Row] = await dataSource.query<{ is_revoked: boolean; revoked_reason: string }[]>(
      `SELECT is_revoked, revoked_reason FROM refresh_tokens WHERE id = $1`,
      [ids.sessionB1],
    );
    expect(sessionB1Row.is_revoked).toBe(true);
    expect(sessionB1Row.revoked_reason).toBe('account_deletion');

    const [userBRow] = await dataSource.query<{ is_active: boolean; deleted_at: string | null }[]>(
      `SELECT is_active, deleted_at FROM users WHERE id = $1`,
      [ids.userB],
    );
    expect(userBRow.is_active).toBe(false);
    expect(userBRow.deleted_at).not.toBeNull();

    // getMe() بيستخدم Repository<User>.findOne() العادي، واللي بيستثني الصفوف الـsoft-deleted
    // تلقائيًا (TypeORM's @DeleteDateColumn behavior) — يعني حتى لو access token قديم لسه
    // "صالح" شكليًا (JWT stateless لحد انتهاء صلاحيته الطبيعية)، أي محاولة getMe() بيه بعد
    // deleteMe() بترجع "المستخدم غير موجود" بأمان، مش بروفايل حساب محذوف. الحماية الأعمق
    // (رفض فوري في JwtStrategy.validate() قبل حتى ما يوصل للـcontroller) مختبرة في
    // jwt-strategy-active-user-check.spec.ts.
    await expect(service.getMe(ids.userB)).rejects.toMatchObject({ code: 'AUTH_001' });
  });
});
