import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { PermissionsService } from '../admin/permissions.service';
import { Permission } from '../admin/entities/permission.entity';
import { Role } from '../admin/entities/role.entity';
import { UserRole } from '../admin/entities/user-role.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { User } from '../auth/entities/user.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { EmployeeDailyActivity } from './entities/employee-daily-activity.entity';
import { SecurityEventNote } from './entities/security-event-note.entity';
import { SecurityEvent, SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from './entities/security-event.entity';
import { SecurityEventsService } from './security-events.service';
import { WorkforceActivityService } from './workforce-activity.service';

// اختبارات سباق صريحة (Script 5 Part 20) — Promise.allSettled حقيقي ضد Postgres حقيقي، مش تحقق
// منطقي بالتتابع (اللي اتعمل في السبِكات التانية بالفعل). 5 سيناريوهات (A-E)، كل واحد بيغطي نقطة
// سباق حقيقية مختلفة في الموديول ده تحديدًا.
describe('Security/Workforce — اختبارات سباق صريحة (Script 5 Part 20 A-E)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let securityEvents: SecurityEventsService;
  let workforce: WorkforceActivityService;
  let permissionsService: PermissionsService;

  const runId = Date.now().toString(36);
  const ids = { roleLow: '', actorEscalate: '', actorHeartbeat: '', actorDenial: '', sessionC: '', eventD: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, Role, Permission, UserRole, RefreshToken, AuditLog, Setting, EmployeeDailyActivity, SecurityEvent, SecurityEventNote],
    });
    await dataSource.initialize();

    const auditLog = new AuditLogService(dataSource.getRepository(AuditLog));
    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settings = new SettingsService(dataSource.getRepository(Setting), auditLog, cache);
    securityEvents = new SecurityEventsService(
      dataSource,
      dataSource.getRepository(SecurityEvent),
      dataSource.getRepository(SecurityEventNote),
      auditLog,
      settings,
      new EventEmitter2(),
    );
    workforce = new WorkforceActivityService(dataSource, dataSource.getRepository(RefreshToken), settings, auditLog);
    permissionsService = new PermissionsService(
      dataSource,
      dataSource.getRepository(Role),
      dataSource.getRepository(Permission),
      dataSource.getRepository(UserRole),
      dataSource.getRepository(User),
      auditLog,
      securityEvents,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    let phoneCounter = 0;
    const mkAdmin = async (label: string) => {
      phoneCounter += 1;
      const phone = `+23${String(phoneCounter).padStart(3, '0')}${runId}`.slice(0, 15);
      const [row] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
        phone,
        `أدمن اختبار سباق ${label} ${runId}`,
      ]);
      return row.id as string;
    };
    ids.actorEscalate = await mkAdmin('escalate');
    ids.actorHeartbeat = await mkAdmin('heartbeat');
    ids.actorDenial = await mkAdmin('denial');

    const [session] = await q(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '7 days') RETURNING id`,
      [ids.actorHeartbeat, `hash-race-${runId}`],
    );
    ids.sessionC = session.id;

    const [event] = await q(
      `INSERT INTO security_events (event_type, severity, status, actor_user_id, action, first_occurred_at, last_occurred_at)
       VALUES ($1,$2,'open',$3,'test.race_resolve', now(), now()) RETURNING id`,
      [SecurityEventType.SENSITIVE_ACTION_DENIED, SecurityEventSeverity.WARNING, ids.actorDenial],
    );
    ids.eventD = event.id;
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const actors = [ids.actorEscalate, ids.actorHeartbeat, ids.actorDenial];
    await q(`DELETE FROM security_events WHERE actor_user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM employee_daily_activity WHERE user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [actors]);
    await cache?.onModuleDestroy();
    await dataSource.destroy();
  });

  it('سيناريو A — heartbeat متزامن (5 نداء بالتوازي) لنفس المستخدم: صف واحد بس، مفيش كراش/duplicate key', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => workforce.heartbeat(ids.actorHeartbeat)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const rows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM employee_daily_activity WHERE user_id = $1 AND activity_date = CURRENT_DATE`,
      [ids.actorHeartbeat],
    );
    // ON CONFLICT (user_id, activity_date) DO UPDATE في heartbeat() بيحمي من duplicate rows حتى
    // لو 5 inserts حصلوا في نفس اللحظة بالظبط.
    expect(rows.length).toBe(1);
  });

  it('سيناريو B — recordDenial متزامن (5 نداء بالتوازي) لنفس (actor+event_type+action): مفيش كراش، صف واحد بس، occurrence_count = 5 بالظبط (Script 7 Phase 30 — كانت فلاكي، اتصلحت فعليًا بقفل استشاري)', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        securityEvents.recordDenial({
          eventType: SecurityEventType.SENSITIVE_ACTION_DENIED,
          severity: SecurityEventSeverity.WARNING,
          actorUserId: ids.actorDenial,
          action: 'test.race_denial',
        }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const rows = await dataSource.query<{ occurrence_count: number }[]>(
      `SELECT occurrence_count FROM security_events WHERE actor_user_id = $1 AND action = 'test.race_denial'`,
      [ids.actorDenial],
    );
    // إصلاح حقيقي (Script 7 Phase 30) — قفل استشاري (pg_advisory_xact_lock) على مفتاح الـdedup
    // بيسلسل النداءات المتزامنة بالكامل، فمفيش صفين مكرّرين يتعملوا خالص ولا UPDATE يطابق أكتر من
    // صف واحد (كانت البَقّة الحقيقية: صفين مكرّرين + UPDATE واحد بيزوّد الاتنين مع بعض، فمجموع
    // occurrence_count كان بيتضخّم أسرع من عدد النداءات الفعلية — اتأكد حيًا: مجموع 7 مش 5 قبل
    // الإصلاح). دلوقتي الفحص صريح: صف واحد بالظبط، occurrence_count = 5 بالظبط.
    expect(rows.length).toBe(1);
    expect(rows[0].occurrence_count).toBe(5);
  });

  it('سيناريو C — إلغاء نفس الجلسة بالتوازي (3 نداء): واحد بس ينجح، الباقي يترفض 404 (مفيش double-revoke)', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => workforce.revokeEmployeeSession(ids.actorHeartbeat, ids.actorHeartbeat, ids.sessionC)),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);

    const [row] = await dataSource.query<{ is_revoked: boolean }[]>(`SELECT is_revoked FROM refresh_tokens WHERE id = $1`, [ids.sessionC]);
    expect(row.is_revoked).toBe(true);
  });

  it('سيناريو D — أدمنين مختلفين بيحلّوا نفس التنبيه بالتوازي (Part 20 اختبار E الأصلي): واحد بس ينجح، الباقي 409', async () => {
    const results = await Promise.allSettled([
      securityEvents.resolve(ids.actorDenial, ids.eventD, SecurityEventStatus.RESOLVED, 'حل من أدمن 1'),
      securityEvents.resolve(ids.actorHeartbeat, ids.eventD, SecurityEventStatus.FALSE_POSITIVE, 'حل من أدمن 2'),
      securityEvents.resolve(ids.actorEscalate, ids.eventD, SecurityEventStatus.RESOLVED, 'حل من أدمن 3'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);
    for (const r of rejected) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'VAL_001' });
    }

    const [row] = await dataSource.query<{ status: SecurityEventStatus }[]>(`SELECT status FROM security_events WHERE id = $1`, [ids.eventD]);
    expect([SecurityEventStatus.RESOLVED, SecurityEventStatus.FALSE_POSITIVE]).toContain(row.status);
  });

  it('سيناريو E — محاولات تصعيد ذاتي متزامنة (5 نداء بالتوازي): كل المحاولات ترفض 403، صفر تغيير دور نهائي', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => permissionsService.assignRole(ids.actorEscalate, ids.actorEscalate, 'super_admin')),
    );
    // الغاية الأمنية الحرجة هنا: صفر نجاح، مهما كان السباق — مش عدد الأحداث الأمنية بالظبط.
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'AUTH_001' });
    }

    const roles = await permissionsService.listUserRoles(ids.actorEscalate);
    expect(roles.some((r) => r.role_name === 'super_admin')).toBe(false);
  });
});
