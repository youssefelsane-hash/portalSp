import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { SecurityEventCreatedEvent, SECURITY_EVENT_CREATED_EVENT } from '../../common/events/security-event-created.event';
import { AuditLogService } from '../audit/audit-log.service';
import { SettingsService } from '../settings/settings.service';
import { SecurityEventNote } from './entities/security-event-note.entity';
import { SecurityEvent, SecurityEventSeverity, SecurityEventStatus, SecurityEventType } from './entities/security-event.entity';

export interface RecordDenialParams {
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  actorUserId: string | null;
  actorRole?: string | null;
  targetUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  action?: string | null;
  attemptedValue?: Record<string, unknown> | null;
}

export interface ListSecurityEventsQuery {
  severity?: SecurityEventSeverity;
  status?: SecurityEventStatus;
  actor_user_id?: string;
  event_type?: SecurityEventType;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

// نموذج Security Event المركزي (Script 5 Part 5/18/19، docs/adr/0016). الـaudit_logs الموجود فاضل
// مصدر الحقيقة التفصيلي (immutable) — الجدول ده تصنيف/severity/lifecycle/تجميع فوقه، مش بديل عنه.
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SecurityEvent) private readonly events: Repository<SecurityEvent>,
    @InjectRepository(SecurityEventNote) private readonly notes: Repository<SecurityEventNote>,
    private readonly auditLog: AuditLogService,
    private readonly settings: SettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * بتتنادى من نقاط الرفض الحساسة (PermissionsGuard/StepUpGuard/PermissionsService) — best-effort
   * صراحة (try/catch شامل هنا)، فشل تسجيل الحدث الأمني مايمنعش الـ403 الأصلي من الحدوث أبداً،
   * نفس فلسفة AuditLogService.record() non-blocking تمامًا (audit/audit-log.service.ts).
   *
   * Dedup (Part 5 §13): بحث عن حدث OPEN مطابق (actor+type+action) جوّه نافذة زمنية، لو لقى بيزوّد
   * occurrence_count بدل صف جديد. سباق حقيقي نادر ممكن يعمل صفين بدل واحد وقت أول حدثين متطابقين
   * بالضبط في نفس اللحظة (فجوة موثّقة صراحة في README — مش حرج ماليًا، تنبيه أمني بس).
   */
  async recordDenial(params: RecordDenialParams): Promise<void> {
    try {
      const windowSeconds = await this.settings.getNumber('security.dedup_window_seconds', 300);
      let createdEvent: SecurityEvent | null = null;

      await this.dataSource.transaction(async (manager) => {
        // manager.query() لـUPDATE بيرجّع tuple [rows, affectedCount] مش الصفوف مباشرة — نفس
        // المصيدة اللي اتصلحت في resolve() تحت.
        const [existingRows] = await manager.query<[{ id: string }[], number]>(
          `UPDATE security_events
           SET occurrence_count = occurrence_count + 1, last_occurred_at = now(), updated_at = now()
           WHERE actor_user_id IS NOT DISTINCT FROM $1
             AND event_type = $2
             AND action IS NOT DISTINCT FROM $3
             AND status = 'open'
             AND last_occurred_at > now() - ($4 || ' seconds')::interval
           RETURNING id`,
          [params.actorUserId, params.eventType, params.action ?? null, windowSeconds],
        );
        if (existingRows.length > 0) return;

        const now = new Date();
        const entity = manager.getRepository(SecurityEvent).create({
          eventType: params.eventType,
          severity: params.severity,
          status: SecurityEventStatus.OPEN,
          actorUserId: params.actorUserId,
          actorRole: params.actorRole ?? null,
          targetUserId: params.targetUserId ?? null,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          sessionId: params.sessionId ?? null,
          ipAddress: params.ipAddress ?? null,
          action: params.action ?? null,
          attemptedValue: params.attemptedValue ?? null,
          occurrenceCount: 1,
          firstOccurredAt: now,
          lastOccurredAt: now,
        });
        createdEvent = await manager.getRepository(SecurityEvent).save(entity);
      });

      // audit trail تفصيلي دايمًا (سواء صف جديد أو تجميع) — audit_logs immutable، ده السجل الكامل.
      await this.auditLog.record({
        actorUserId: params.actorUserId,
        actorRole: params.actorRole ?? null,
        action: 'security.access_denied',
        entityType: params.targetType ?? 'security_event',
        entityId: params.targetId ?? params.actorUserId ?? '00000000-0000-0000-0000-000000000000',
        newValues: { event_type: params.eventType, severity: params.severity, action: params.action, attempted_value: params.attemptedValue },
        meta: { ip: params.ipAddress ?? null, userAgent: null, requestId: null },
      });

      if (params.actorUserId) {
        await this.bumpDeniedCounter(params.actorUserId).catch((err: unknown) => {
          this.logger.warn(`فشل تحديث عداد الرفض اليومي: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      // تنبيه لحظي أول مرة الحدث يتخلق بس — مش على كل تجميع (Part 5 §13، Part 6).
      if (createdEvent) {
        const event = createdEvent as SecurityEvent;
        this.eventEmitter.emit(
          SECURITY_EVENT_CREATED_EVENT,
          new SecurityEventCreatedEvent(event.id, event.eventType, event.severity, event.actorUserId),
        );
      }
    } catch (err) {
      this.logger.error(
        `فشل تسجيل حدث أمني (${params.eventType}) للفاعل ${params.actorUserId ?? 'مجهول'} — الرفض الأصلي مستمر عادي`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async bumpDeniedCounter(userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.dataSource.query(
      `INSERT INTO employee_daily_activity (user_id, activity_date, denied_sensitive_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, activity_date)
       DO UPDATE SET denied_sensitive_count = employee_daily_activity.denied_sensitive_count + 1, updated_at = now()`,
      [userId, today],
    );
  }

  async list(query: ListSecurityEventsQuery): Promise<{ items: SecurityEvent[]; meta: { page: number; per_page: number; total: number } }> {
    const page = query.page ?? 1;
    const perPage = Math.min(query.per_page ?? 20, 100);
    const qb = this.events.createQueryBuilder('e').orderBy('e.last_occurred_at', 'DESC');
    if (query.severity) qb.andWhere('e.severity = :severity', { severity: query.severity });
    if (query.status) qb.andWhere('e.status = :status', { status: query.status });
    if (query.actor_user_id) qb.andWhere('e.actor_user_id = :actorUserId', { actorUserId: query.actor_user_id });
    if (query.event_type) qb.andWhere('e.event_type = :eventType', { eventType: query.event_type });
    if (query.from) qb.andWhere('e.last_occurred_at >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.last_occurred_at <= :to', { to: query.to });
    const [items, total] = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();
    return { items, meta: { page, per_page: perPage, total } };
  }

  async getOrThrow(id: string): Promise<SecurityEvent> {
    const event = await this.events.findOne({ where: { id } });
    if (!event) throw new ApiException(ErrorCode.VAL_001, 'الحدث الأمني غير موجود', HttpStatus.NOT_FOUND);
    return event;
  }

  async listNotes(securityEventId: string): Promise<SecurityEventNote[]> {
    return this.notes.find({ where: { securityEventId }, order: { createdAt: 'ASC' } });
  }

  async addNote(actorUserId: string, securityEventId: string, note: string): Promise<SecurityEventNote> {
    await this.getOrThrow(securityEventId);
    return this.notes.save(this.notes.create({ securityEventId, authorUserId: actorUserId, note }));
  }

  async acknowledge(actorUserId: string, id: string): Promise<SecurityEvent> {
    const event = await this.getOrThrow(id);
    if (event.status !== SecurityEventStatus.OPEN) {
      throw new ApiException(ErrorCode.VAL_001, 'الحدث ده مش في حالة مفتوحة أصلاً', HttpStatus.CONFLICT);
    }
    event.status = SecurityEventStatus.ACKNOWLEDGED;
    event.acknowledgedByUserId = actorUserId;
    event.acknowledgedAt = new Date();
    const saved = await this.events.save(event);
    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'security_event.acknowledged',
      entityType: 'security_event',
      entityId: id,
    });
    return saved;
  }

  async setInvestigating(actorUserId: string, id: string): Promise<SecurityEvent> {
    const event = await this.getOrThrow(id);
    if (event.status === SecurityEventStatus.RESOLVED || event.status === SecurityEventStatus.FALSE_POSITIVE) {
      throw new ApiException(ErrorCode.VAL_001, 'الحدث ده اتقفل بالفعل', HttpStatus.CONFLICT);
    }
    event.status = SecurityEventStatus.INVESTIGATING;
    const saved = await this.events.save(event);
    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'security_event.investigating',
      entityType: 'security_event',
      entityId: id,
    });
    return saved;
  }

  /**
   * حماية سباق (Part 20 اختبار E: أدمنين اتنين بيحلّوا نفس التنبيه بالتوازي) — تحديث شرطي
   * (WHERE status != المطلوب) بدل قراءة-ثم-كتابة، فالتاني بيترفض بوضوح مش يكتب فوق الأول بصمت.
   */
  async resolve(actorUserId: string, id: string, status: SecurityEventStatus.RESOLVED | SecurityEventStatus.FALSE_POSITIVE, resolutionNote?: string): Promise<SecurityEvent> {
    // ملاحظة مهمة: dataSource.query() لـUPDATE/DELETE بيرجّع tuple [rows, affectedCount] مش
    // مصفوفة الصفوف مباشرة (PostgresQueryRunner.query في TypeORM) — لازم destructure، وإلا
    // .length بيبقى 2 دايمًا (مصيدة حقيقية اتلقطت هنا وقت الاختبار الحي، Part 20 اختبار E).
    const [rows] = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE security_events
       SET status = $1, resolved_by_user_id = $2, resolved_at = now(), resolution_note = $3, updated_at = now()
       WHERE id = $4 AND status NOT IN ('resolved', 'false_positive')
       RETURNING id`,
      [status, actorUserId, resolutionNote ?? null, id],
    );
    if (rows.length === 0) {
      const exists = await this.events.findOne({ where: { id } });
      if (!exists) throw new ApiException(ErrorCode.VAL_001, 'الحدث الأمني غير موجود', HttpStatus.NOT_FOUND);
      throw new ApiException(ErrorCode.VAL_001, 'الحدث ده اتقفل بالفعل (حد تاني قفله)', HttpStatus.CONFLICT);
    }
    await this.auditLog.record({
      actorUserId,
      actorRole: 'admin',
      action: 'security_event.resolved',
      entityType: 'security_event',
      entityId: id,
      newValues: { status, resolution_note: resolutionNote ?? null },
    });
    return this.getOrThrow(id);
  }

  async countOpenBySeverity(): Promise<{ severity: SecurityEventSeverity; count: number }[]> {
    const rows = await this.dataSource.query<{ severity: SecurityEventSeverity; count: string }[]>(
      `SELECT severity, count(*)::int AS count FROM security_events WHERE status = 'open' GROUP BY severity`,
    );
    return rows.map((r) => ({ severity: r.severity, count: Number(r.count) }));
  }
}
