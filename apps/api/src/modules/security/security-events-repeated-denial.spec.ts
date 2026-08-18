import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { SecurityEventNote } from './entities/security-event-note.entity';
import { SecurityEvent, SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from './entities/security-event.entity';
import { SecurityEventsService } from './security-events.service';

// اختبار حي ضد Postgres حقيقي — Script 5 Part 10 (كشف رفض متكرر/تجميع تنبيهات). سيناريوهين
// مختلفين عمداً عن dedup العادي (اللي بيتحقق منه في security-events-privilege-escalation.spec.ts):
// (أ) نفس الفعل بالظبط بيترفض كتير على التوالي → تصعيد severity للحدث الموجود نفسه.
// (ب) أفعال مختلفة بترفض لنفس الفاعل خلال نافذة قصيرة → حدث REPEATED_PERMISSION_DENIAL CRITICAL
//     جديد تجميعي، منفصل عن الأحداث الأصلية.
describe('SecurityEventsService — تصعيد ورفض متكرر (Script 5 Part 10)', () => {
  let dataSource: DataSource;
  let securityEvents: SecurityEventsService;

  const runId = Date.now().toString(36);
  const ids = { actorEscalate: '', actorBurst: '' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, AuditLog, Setting, SecurityEvent, SecurityEventNote],
    });
    await dataSource.initialize();

    const auditLog = new AuditLogService(dataSource.getRepository(AuditLog));
    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settings = new SettingsService(dataSource.getRepository(Setting), auditLog, cache);
    securityEvents = new SecurityEventsService(
      dataSource,
      dataSource.getRepository(SecurityEvent),
      dataSource.getRepository(SecurityEventNote),
      auditLog,
      settings,
      new EventEmitter2(),
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    let phoneCounter = 0;
    const mkAdmin = async (label: string) => {
      phoneCounter += 1;
      const phone = `+22${String(phoneCounter).padStart(3, '0')}${runId}`.slice(0, 15);
      const [row] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
        phone,
        `أدمن اختبار رفض متكرر ${label} ${runId}`,
      ]);
      return row.id as string;
    };
    ids.actorEscalate = await mkAdmin('escalate');
    ids.actorBurst = await mkAdmin('burst');
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const actors = [ids.actorEscalate, ids.actorBurst];
    await q(`DELETE FROM security_events WHERE actor_user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM employee_daily_activity WHERE user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1)`, [actors]);
    await q(`DELETE FROM users WHERE id = ANY($1)`, [actors]);
    await dataSource.destroy();
  });

  it('نفس الفعل يترفض 5 مرات على التوالي → صف واحد بس، severity بيتصعّد من WARNING لـHIGH عند العتبة (5)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await securityEvents.recordDenial({
        eventType: SecurityEventType.SENSITIVE_ACTION_DENIED,
        severity: SecurityEventSeverity.WARNING,
        actorUserId: ids.actorEscalate,
        action: 'test.repeated_same_action',
      });
    }

    const rows = await dataSource.query<{ occurrence_count: number; severity: SecurityEventSeverity }[]>(
      `SELECT occurrence_count, severity FROM security_events WHERE actor_user_id = $1 AND action = 'test.repeated_same_action'`,
      [ids.actorEscalate],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].occurrence_count).toBe(5);
    expect(rows[0].severity).toBe(SecurityEventSeverity.HIGH);
  });

  it('5 أفعال مختلفة بترفض لنفس الفاعل خلال نافذة قصيرة → حدث REPEATED_PERMISSION_DENIAL CRITICAL تجميعي', async () => {
    for (let i = 0; i < 5; i += 1) {
      await securityEvents.recordDenial({
        eventType: SecurityEventType.SENSITIVE_ACTION_DENIED,
        severity: SecurityEventSeverity.WARNING,
        actorUserId: ids.actorBurst,
        action: `test.burst_action_${i}`,
      });
    }

    const [burstEvent] = await dataSource.query<
      { event_type: SecurityEventType; severity: SecurityEventSeverity; status: SecurityEventStatus; attempted_value: Record<string, unknown> }[]
    >(
      `SELECT event_type, severity, status, attempted_value FROM security_events
       WHERE actor_user_id = $1 AND event_type = $2`,
      [ids.actorBurst, SecurityEventType.REPEATED_PERMISSION_DENIAL],
    );
    expect(burstEvent).toBeDefined();
    expect(burstEvent.severity).toBe(SecurityEventSeverity.CRITICAL);
    expect(burstEvent.status).toBe(SecurityEventStatus.OPEN);
    expect(Number(burstEvent.attempted_value.distinct_denials_in_window)).toBeGreaterThanOrEqual(5);

    // صف واحد بس لكل الخمس أفعال (مش حدث تجميعي جديد لكل رفض بعد ما العتبة اتعدّت — بيتجمّع).
    const burstRows = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM security_events WHERE actor_user_id = $1 AND event_type = $2`,
      [ids.actorBurst, SecurityEventType.REPEATED_PERMISSION_DENIAL],
    );
    expect(burstRows.length).toBe(1);
  });
});
