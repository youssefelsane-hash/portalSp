import { DataSource } from 'typeorm';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { EmployeeDailyActivity } from './entities/employee-daily-activity.entity';
import { EmployeePresenceState, WorkforceActivityService } from './workforce-activity.service';

// اختبار حي ضد Postgres حقيقي — Script 5 Part 2/4/6/12/16 (حالة الجلسة الحية، وقت العمل الفعلي،
// إلغاء جلسة موظف بعينها). idle threshold بتتحط 2 ثانية بس هنا عبر إعداد حقيقي (settings) عشان
// الاختبار يقدر يتحقق من انتقال ACTIVE→IDLE من غير ما يستنى 5 دقايق حقيقية.
describe('WorkforceActivityService — حالة الجلسة/وقت العمل/إلغاء جلسة بعينها (Script 5)', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let cache: RedisCacheService;
  let service: WorkforceActivityService;
  const runId = Date.now().toString(36);
  const ids = { user: '', employeeProfileId: '', sessionA: '', sessionB: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, RefreshToken, Setting, EmployeeDailyActivity, AuditLog],
    });
    await dataSource.initialize();

    const auditLog = new AuditLogService(dataSource.getRepository(AuditLog));
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settings = new SettingsService(dataSource.getRepository(Setting), auditLog, cache);
    service = new WorkforceActivityService(dataSource, dataSource.getRepository(RefreshToken), settings, auditLog);

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    // عتبة idle قصيرة (2 ثانية) بس لهذا الاختبار — بديل حقيقي عن انتظار 5 دقايق فعلية.
    //
    // **UPSERT مش INSERT**: المفتاح ده بقى مزروع دايمًا (migration 0264 + سجل الإعدادات) — قبل
    // كده مكانش ليه صف، فالـINSERT الخام كان بيشتغل. بعد البذر، نفس السطر بقى بيرمي
    // duplicate key فيسقط `beforeAll` وكل الاختبارات معاه. الـUPSERT بيشتغل في الحالتين.
    await q(`
      INSERT INTO settings (key, value, value_type, group_name)
      VALUES ('workforce.idle_threshold_seconds', '2', 'number', 'workforce')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `);
    // الكتابة فوق SQL خام بتتخطى كاش `SettingsService` (TTL 60 ثانية) — من غير الإبطال ده،
    // أي قراءة سابقة للمفتاح (من سبيك تاني في نفس التشغيلة) بتفضل مخبّية 300 والاختبار يستنى
    // انتقال ACTIVE→IDLE عمره ما هيحصل في 2.5 ثانية. ده كان بيعلّق السبيك مش بس يفشّله.
    await cache.del('settings:workforce.idle_threshold_seconds');
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2099${runId}`.slice(0, 15),
      `أدمن اختبار نشاط ${runId}`,
    ]);
    ids.user = user.id;
    const [profile] = await q(
      `INSERT INTO employee_profiles (user_id, employee_code, department) VALUES ($1,$2,'operations') RETURNING id`,
      [ids.user, `EMP-TEST-${runId}`.slice(0, 24)],
    );
    ids.employeeProfileId = profile.id;
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM employee_daily_activity WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM audit_logs WHERE actor_user_id = $1 OR entity_id = $1`, [ids.user]);
    await q(`DELETE FROM refresh_tokens WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM employee_profiles WHERE user_id = $1`, [ids.user]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    // **ترجيع القيمة المسجّلة مش حذف الصف**: المفتاح ده جزء من سجل الإعدادات دلوقتي، وحذفه
    // بيكسر ثابتة «كل مفتاح مسجّل له صف» — يعني السبيك ده كان هيفشّل `settings-registry.spec.ts`
    // لو اتنفّذ قبله. الرقم 300 هو نفس الافتراضي في السجل وفي `DEFAULT_IDLE_THRESHOLD_SECONDS`.
    await q(`UPDATE settings SET value = '300' WHERE key = 'workforce.idle_threshold_seconds'`);
    await cache?.del('settings:workforce.idle_threshold_seconds');
    await cache?.onModuleDestroy();
    await dataSource.destroy();
  });

  it('OFFLINE: صفر جلسة نشطة', async () => {
    const presence = await service.getPresence(ids.user);
    expect(presence.state).toBe(EmployeePresenceState.OFFLINE);
    expect(presence.active_sessions_count).toBe(0);
  });

  it('ACTIVE فورًا بعد heartbeat، IDLE بعد ما العتبة تعدّي', async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [session] = await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '7 days') RETURNING id`,
      [ids.user, `hash-${runId}-a`],
    );
    ids.sessionA = session.id;

    await service.recordLogin(ids.user);
    await service.heartbeat(ids.user);

    const activePresence = await service.getPresence(ids.user);
    expect(activePresence.state).toBe(EmployeePresenceState.ACTIVE);
    expect(activePresence.active_sessions_count).toBe(1);

    // نستنى أكتر من عتبة الـidle (2 ثانية) من غير أي heartbeat جديد.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const idlePresence = await service.getPresence(ids.user);
    expect(idlePresence.state).toBe(EmployeePresenceState.IDLE);
  }, 10000);

  it('وقت العمل الفعلي: فجوة heartbeat ≤ العتبة بتتضاف، فجوة أكبر متتضافش', async () => {
    // الحالة الحالية: last_activity_at من الاختبار اللي فات (منذ ~2.5 ثانية idle). الفجوة دي
    // أكبر من العتبة (2 ثانية) فمفروض متتضافش لـactive_seconds.
    const beforeGap = await dataSource.query<{ active_seconds: number }[]>(
      `SELECT active_seconds FROM employee_daily_activity WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
      [ids.user],
    );
    await service.heartbeat(ids.user);
    const afterIdleGap = await dataSource.query<{ active_seconds: number }[]>(
      `SELECT active_seconds FROM employee_daily_activity WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
      [ids.user],
    );
    // الفجوة (idle حقيقي) اتجاهلت — active_seconds ما اتزودش.
    expect(afterIdleGap[0].active_seconds).toBe(beforeGap[0].active_seconds);

    // heartbeat تاني بعد فجوة صغيرة (≤ العتبة) لازم يضيف وقت فعلي هالمرة — 1.2 ثانية بس (مش أقل)
    // عشان الفجوة تقرّب لثانية كاملة (active_seconds عمود integer، ومعدل heartbeat الحقيقي كل
    // دقيقة فمفيش تقريب-لصفر حقيقي في الإنتاج، بس هنا محتاجين فجوة ≥ نص ثانية عشان Math.round تزيد).
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await service.heartbeat(ids.user);
    const afterActiveGap = await dataSource.query<{ active_seconds: number }[]>(
      `SELECT active_seconds FROM employee_daily_activity WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
      [ids.user],
    );
    expect(afterActiveGap[0].active_seconds).toBeGreaterThan(afterIdleGap[0].active_seconds);
  }, 10000);

  it('ملخص القوى العاملة: بيرجّع صف الموظف بالبيانات الصح', async () => {
    const summary = await service.getWorkforceSummary();
    const row = summary.find((r) => r.user_id === ids.user);
    expect(row).toBeDefined();
    expect(row?.department).toBe('operations');
    expect(row?.sessions_today).toBe(1);
    expect(row?.active_seconds_today).toBeGreaterThan(0);
  });

  it('إلغاء جلسة موظف بعينها: تنجح مرة، وترفض 404 لو اتكررت', async () => {
    await service.revokeEmployeeSession(ids.user, ids.user, ids.sessionA);
    const [row] = await dataSource.query<{ is_revoked: boolean; revoked_reason: string }[]>(
      `SELECT is_revoked, revoked_reason FROM refresh_tokens WHERE id = $1`,
      [ids.sessionA],
    );
    expect(row.is_revoked).toBe(true);
    expect(row.revoked_reason).toBe('admin_revoked_session');

    await expect(service.revokeEmployeeSession(ids.user, ids.user, ids.sessionA)).rejects.toMatchObject({
      code: 'VAL_001',
    });

    const presence = await service.getPresence(ids.user);
    expect(presence.state).toBe(EmployeePresenceState.OFFLINE);
  });
});
