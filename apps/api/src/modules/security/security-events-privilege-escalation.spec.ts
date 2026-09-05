import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { PermissionsService } from '../admin/permissions.service';
import { Permission } from '../admin/entities/permission.entity';
import { Role } from '../admin/entities/role.entity';
import { UserRole } from '../admin/entities/user-role.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { SecurityEventNote } from './entities/security-event-note.entity';
import { SecurityEvent, SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from './entities/security-event.entity';
import { SecurityEventsService } from './security-events.service';

// اختبار حي ضد Postgres حقيقي — Script 5 Part 4/5/24 (تصعيد صلاحيات + نموذج Security Event).
// سيناريو #1/#2 صراحة من السكريبت: "Call Center attempts to assign self Super Admin. Expected:
// 403/domain denial. No role change. CRITICAL security event. Super Admin notification/alert."
// هنا بنتحقق من الجزء اللي مسؤول عنه PermissionsService/SecurityEventsService مباشرة (منطق الرفض
// + الحدث الأمني + الـdedup) — تحقق التنبيه اللحظي الكامل (routing→notifications) اتعمل حي كمان
// بـcurl ضد dev server شغال (موثّق في README).
describe('SecurityEventsService — تصعيد صلاحيات → حدث أمني (Script 5 Part 4/5/24)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let permissionsService: PermissionsService;
  let securityEvents: SecurityEventsService;

  const runId = Date.now().toString(36);
  const ids = {
    roleLow: '',
    roleHigh: '',
    actorLow: '',
    target: '',
    // كان ناقص، والنتيجة تسريب حقيقي: كل تشغيلة كانت بتسيب صف `permissions` وراها للأبد
    // (٢٥٠+ صف `test.sec.alpha.*` اتراكموا في قاعدة التطوير). كتالوج الصلاحيات مش جدول
    // مؤقت — محرّر الأدوار في لوحة الأدمن بيعرضه كله للمشغّل.
    permAlpha: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, Role, Permission, UserRole, AuditLog, Setting, SecurityEvent, SecurityEventNote],
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
    const [permA] = await q(
      `INSERT INTO permissions (name, resource, action) VALUES ($1,'test_resource',$2) RETURNING id`,
      [`test.sec.alpha.${runId}`, `alpha_${runId}`],
    );
    ids.permAlpha = permA.id;
    const [roleLow] = await q(`INSERT INTO roles (name, display_name) VALUES ($1,$2) RETURNING id`, [
      `role_sec_low_${runId}`,
      'دور منخفض (اختبار أمان)',
    ]);
    ids.roleLow = roleLow.id;
    await q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [ids.roleLow, permA.id]);

    let phoneCounter = 0;
    const mkAdmin = async (label: string) => {
      phoneCounter += 1;
      const phone = `+21${String(phoneCounter).padStart(3, '0')}${runId}`.slice(0, 15);
      const [row] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
        phone,
        `أدمن اختبار أمان ${label} ${runId}`,
      ]);
      return row.id as string;
    };
    ids.actorLow = await mkAdmin('actor-low');
    await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)`, [ids.actorLow, ids.roleLow]);
    ids.target = await mkAdmin('target');
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM security_events WHERE actor_user_id = ANY($1)`, [[ids.actorLow]]);
    await q(`DELETE FROM employee_daily_activity WHERE user_id = ANY($1)`, [[ids.actorLow, ids.target]]);
    await q(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [[ids.actorLow, ids.target]]);
    await q(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1) OR entity_id = ANY($1)`, [[ids.actorLow, ids.target]]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [[ids.actorLow, ids.target]]);
    await q(`DELETE FROM roles WHERE id = $1`, [ids.roleLow]);
    await q(`DELETE FROM permissions WHERE id = $1`, [ids.permAlpha]);
    await cache?.onModuleDestroy();
    await dataSource.destroy();
  });

  it('سيناريو #1 — محاولة تصعيد ذاتي حرفي (actor=target) لدور super_admin: 403، صفر تغيير دور، حدث CRITICAL', async () => {
    await expect(permissionsService.assignRole(ids.actorLow, ids.actorLow, 'super_admin')).rejects.toMatchObject({
      code: 'AUTH_001',
    });

    const roles = await permissionsService.listUserRoles(ids.actorLow);
    expect(roles.some((r) => r.role_name === 'super_admin')).toBe(false);

    const [event] = await dataSource.query<
      { event_type: SecurityEventType; severity: SecurityEventSeverity; status: SecurityEventStatus; target_user_id: string; occurrence_count: number }[]
    >(
      `SELECT event_type, severity, status, target_user_id, occurrence_count FROM security_events
       WHERE actor_user_id = $1 AND action = 'roles.assign' ORDER BY created_at DESC LIMIT 1`,
      [ids.actorLow],
    );
    expect(event).toBeDefined();
    expect(event.event_type).toBe(SecurityEventType.PRIVILEGE_ESCALATION_ATTEMPT);
    expect(event.severity).toBe(SecurityEventSeverity.CRITICAL);
    expect(event.status).toBe(SecurityEventStatus.OPEN);
    expect(event.target_user_id).toBe(ids.actorLow);
  });

  it('سيناريو #2 — نفس المحاولة مرة تانية (API مباشر، صفر واجهة) جوّه نافذة الـdedup: نفس الصف بيتجمّع مش صف جديد', async () => {
    await expect(permissionsService.assignRole(ids.actorLow, ids.actorLow, 'super_admin')).rejects.toMatchObject({
      code: 'AUTH_001',
    });

    const rows = await dataSource.query<{ occurrence_count: number }[]>(
      `SELECT occurrence_count FROM security_events WHERE actor_user_id = $1 AND action = 'roles.assign'`,
      [ids.actorLow],
    );
    // صف واحد بس (مش اتنين) — الـdedup لقى الصف المفتوح المطابق وزوّد العداد بدل ما يعمل صف جديد.
    expect(rows.length).toBe(1);
    expect(rows[0].occurrence_count).toBe(2);
  });

  it('سيناريو #3 — تصعيد لمستخدم تاني (مش الفاعل نفسه): 403 + حدث HIGH مش CRITICAL', async () => {
    await expect(permissionsService.assignRole(ids.actorLow, ids.target, 'super_admin')).rejects.toMatchObject({
      code: 'AUTH_001',
    });

    const [event] = await dataSource.query<{ event_type: SecurityEventType; severity: SecurityEventSeverity; target_user_id: string }[]>(
      `SELECT event_type, severity, target_user_id FROM security_events
       WHERE actor_user_id = $1 AND target_user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [ids.actorLow, ids.target],
    );
    expect(event).toBeDefined();
    expect(event.event_type).toBe(SecurityEventType.UNAUTHORIZED_ROLE_CHANGE);
    expect(event.severity).toBe(SecurityEventSeverity.HIGH);
  });

  it('acknowledge/resolve lifecycle: حالة الحدث بتتغيّر صح، ومحاولة تحل حدث محلول بترفض', async () => {
    const [row] = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM security_events WHERE actor_user_id = $1 AND target_user_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [ids.actorLow, ids.target],
    );
    const acknowledged = await securityEvents.acknowledge(ids.target, row.id);
    expect(acknowledged.status).toBe(SecurityEventStatus.ACKNOWLEDGED);

    const resolved = await securityEvents.resolve(ids.target, row.id, SecurityEventStatus.RESOLVED, 'تم التحقق — مجرد اختبار');
    expect(resolved.status).toBe(SecurityEventStatus.RESOLVED);

    await expect(securityEvents.resolve(ids.target, row.id, SecurityEventStatus.FALSE_POSITIVE)).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });
});
