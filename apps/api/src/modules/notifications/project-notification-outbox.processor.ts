import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runExclusiveSweep } from '../../common/db/sweep-lock';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PROJECT_CHANGED_EVENT, ProjectChangedEvent } from '../../common/events/project-changed.event';
import { NotificationChannel } from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

interface OutboxRow {
  id: string;
  project_id: string;
  action: string;
  actor_user_id: string | null;
  actor_role: 'admin' | 'customer' | 'system';
  details: Record<string, unknown>;
  attempts: number;
}

interface NotificationRecipient {
  userId: string;
  audience: 'admin' | 'customer' | 'technician';
}

const TECHNICIAN_ACTIONS = new Set([
  'project.active',
  'project.paused',
  'project.cancelled',
  'project.completed',
  'project.disputed',
  'project.milestone_started',
  'project.milestone_completed',
  'project.order_linked',
]);

@Injectable()
export class ProjectNotificationOutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectNotificationOutboxProcessor.name);
  private draining = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      // القفل الاستشاري (تدقيق A-2): الصندوق ده بيتعالج من نسخة واحدة بس، وإلا نفس الصف
      // بيتبعت مرتين لما أكتر من instance تلقطه في نفس الثانية.
      void runExclusiveSweep(this.dataSource, 'project-notification-outbox', () => this.sweep(), this.logger);
    }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  @OnEvent(PROJECT_CHANGED_EVENT)
  async onProjectChanged(event: ProjectChangedEvent): Promise<void> {
    await this.drain(20, event.projectId);
  }

  async sweep(): Promise<void> {
    await this.drain(50);
  }

  async drain(limit = 20, projectId?: string): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    try {
      const rows = await this.claim(limit, projectId);
      for (const row of rows) await this.deliver(row);
      return rows.length;
    } finally {
      this.draining = false;
    }
  }

  private async claim(limit: number, projectId?: string): Promise<OutboxRow[]> {
    const result = await this.dataSource.transaction((manager) => manager.query(
      `WITH candidates AS (
         SELECT id FROM project_notification_outbox
         WHERE (status = 'pending' AND next_attempt_at <= now()
            OR status = 'processing' AND locked_at < now() - interval '5 minutes')
           AND ($2::uuid IS NULL OR project_id = $2)
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE project_notification_outbox o
       SET status = 'processing', attempts = attempts + 1, locked_at = now(), last_error = NULL
       FROM candidates c WHERE o.id = c.id
       RETURNING o.id, o.project_id, o.action, o.actor_user_id, o.actor_role, o.details, o.attempts`,
      [Math.max(1, Math.min(100, limit)), projectId ?? null],
    ));
    // TypeORM's PostgreSQL UPDATE ... RETURNING shape is [rows, affectedCount].
    return Array.isArray(result[0]) ? result[0] as OutboxRow[] : result as OutboxRow[];
  }

  private async deliver(row: OutboxRow): Promise<void> {
    try {
      const recipients = await this.recipients(row);
      const message = this.message(row);
      for (const recipient of recipients) {
        await this.notifications.notifyMultiChannel({
          userId: recipient.userId,
          notificationType: row.action,
          titleAr: message.title,
          bodyAr: message.body,
          referenceType: 'project',
          referenceId: row.project_id,
          deepLink: recipient.audience === 'admin'
            ? '/projects'
            : recipient.audience === 'customer'
              ? `/projects/${row.project_id}`
              : undefined,
          sourceOutboxId: row.id,
        }, [NotificationChannel.IN_APP, NotificationChannel.PUSH]);
      }
      await this.dataSource.query(
        `UPDATE project_notification_outbox SET status='delivered', delivered_at=now(), locked_at=NULL WHERE id=$1`,
        [row.id],
      );
    } catch (error) {
      const exhausted = row.attempts >= 5;
      await this.dataSource.query(
        `UPDATE project_notification_outbox
         SET status=$2, locked_at=NULL, last_error=$3,
             next_attempt_at=now() + ($4 * interval '30 seconds')
         WHERE id=$1`,
        [row.id, exhausted ? 'manual_review' : 'pending', error instanceof Error ? error.message.slice(0, 2000) : 'unknown', row.attempts],
      );
      this.logger.error(`Project notification outbox ${row.id} failed`, error instanceof Error ? error.stack : error);
    }
  }

  private async recipients(row: OutboxRow): Promise<NotificationRecipient[]> {
    if (row.actor_role === 'customer') {
      const operationalRecipients = await this.dataSource.query<{ id: string; audience: 'admin' | 'technician' }[]>(
        `SELECT DISTINCT u.id, 'admin'::text AS audience FROM users u
         JOIN user_roles ur ON ur.user_id=u.id
         JOIN role_permissions rp ON rp.role_id=ur.role_id
         JOIN permissions p ON p.id=rp.permission_id
         WHERE p.name='projects.view' AND u.is_active=true AND u.is_blocked=false AND u.deleted_at IS NULL
         UNION
         SELECT tc.owner_user_id AS id, 'technician'::text AS audience
         FROM projects p JOIN technician_companies tc ON tc.id=p.assigned_company_id
         WHERE p.id=$1 AND tc.owner_user_id IS NOT NULL`,
        [row.project_id],
      );
      return operationalRecipients
        .map((recipient) => ({ userId: recipient.id, audience: recipient.audience }))
        .filter((recipient) => recipient.userId !== row.actor_user_id);
    }

    const users = await this.dataSource.query<{ id: string; is_customer: boolean }[]>(
      `SELECT cp.user_id AS id, true AS is_customer
       FROM projects p JOIN customer_profiles cp ON cp.id=p.customer_id WHERE p.id=$1
       UNION
       SELECT tp.user_id AS id, false AS is_customer
       FROM orders o JOIN technician_profiles tp ON tp.id=o.technician_id
       WHERE o.project_id=$1 AND $2::boolean
       UNION
       SELECT tc.owner_user_id AS id, false AS is_customer
       FROM projects p JOIN technician_companies tc ON tc.id=p.assigned_company_id
       WHERE p.id=$1 AND $2::boolean AND tc.owner_user_id IS NOT NULL`,
      [row.project_id, TECHNICIAN_ACTIONS.has(row.action)],
    );
    const recipients = users.map((user) => ({
      userId: user.id,
      audience: user.is_customer ? 'customer' as const : 'technician' as const,
    }));
    if (row.details.visible_to_customer === false) {
      return recipients.filter((recipient) => recipient.audience !== 'customer');
    }
    return recipients.filter((recipient) => recipient.userId !== row.actor_user_id);
  }

  private message(row: OutboxRow): { title: string; body: string } {
    const milestone = String(row.details.milestone_name ?? 'مرحلة المشروع');
    const amount = (value: unknown) => Number.isFinite(Number(value))
      ? `${Math.round(Number(value) / 100).toLocaleString('en-US')} ج.م`
      : null;
    const quoteTotal = amount(row.details.total_cents);
    const milestoneAmount = amount(row.details.milestone_amount_cents);
    const commentPreview = String(row.details.comment_preview ?? '').trim();
    const rejectionReason = String(row.details.reason ?? '').trim();
    const warrantyName = String(row.details.warranty_name ?? 'ضمان المشروع');
    const coverageMonths = Number(row.details.coverage_months ?? 0);
    const messages: Record<string, { title: string; body: string }> = {
      'project.created': { title: 'مشروع جديد محتاج متابعة', body: 'عميل أنشأ مشروعًا جديدًا ويحتاج بدء إجراءات المعاينة.' },
      'project.quote_sent': { title: 'عرض سعر جديد لمشروعك', body: quoteTotal ? `وصلك عرض سعر بإجمالي ${quoteTotal}. افتح المشروع لمراجعة البنود واعتماد العرض.` : 'الإدارة أرسلت عرض السعر. افتح المشروع لمراجعة كل البنود واتخاذ قرارك.' },
      'project.quote_approved': { title: 'العميل وافق على عرض المشروع', body: quoteTotal ? `تم اعتماد عرض السعر بقيمة ${quoteTotal} وأصبح المشروع جاهزًا لاستكمال العربون والمراحل.` : 'تم اعتماد عرض السعر وأصبح المشروع جاهزًا لاستكمال العربون والمراحل.' },
      'project.milestones_created': { title: 'تم تجهيز مراحل مشروعك', body: `تم تقسيم المشروع إلى ${Number(row.details.count ?? 0)} مرحلة، ومبالغها متاحة الآن داخل المشروع.` },
      'project.milestone_started': { title: 'بدأ تنفيذ مرحلة', body: `بدأ العمل في ${milestone}.` },
      'project.milestone_completed': { title: 'مرحلة جاهزة للمراجعة', body: `تم تسليم ${milestone}${milestoneAmount ? ` بقيمة ${milestoneAmount}` : ''}. افتح المشروع للموافقة أو كتابة ملاحظاتك.` },
      'project.milestone_approved': { title: 'العميل وافق على مرحلة', body: `تم اعتماد ${milestone}${milestoneAmount ? ` بقيمة ${milestoneAmount}` : ''}.` },
      'project.milestone_rejected': { title: 'العميل طلب تعديل مرحلة', body: `تم رفض ${milestone}${rejectionReason ? ` والسبب: ${rejectionReason}` : ''}. راجع التفاصيل داخل المشروع.` },
      'project.comment_added': { title: 'رسالة جديدة في المشروع', body: commentPreview || 'تمت إضافة رسالة جديدة إلى سجل المشروع.' },
      'project.order_linked': { title: 'تم ربط طلب بالمشروع', body: 'طلب خدمة أصبح جزءًا من المشروع وسيظهر في سجل التنفيذ.' },
      'project.warranty_issued': { title: 'تم إصدار ضمان المشروع', body: coverageMonths > 0 ? `«${warrantyName}» ساري لمدة ${coverageMonths} شهر، وتفاصيله متاحة في تبويب الضمانات.` : 'الضمان الجديد وتاريخ صلاحيته متاحان الآن داخل تبويب الضمانات.' },
      'project.active': { title: 'بدأ تنفيذ المشروع', body: 'تم تحويل المشروع إلى حالة التنفيذ الفعلي.' },
      'project.paused': { title: 'تم إيقاف المشروع مؤقتًا', body: 'راجع المشروع لمعرفة الحالة الحالية وسبب الإيقاف.' },
      'project.completed': { title: 'اكتمل المشروع', body: 'تم تسجيل اكتمال المشروع. راجع السجل والضمانات النهائية.' },
      'project.cancelled': { title: 'تم إلغاء المشروع', body: 'راجع تفاصيل المشروع لمعرفة سبب الإلغاء.' },
      'project.disputed': { title: 'المشروع قيد المراجعة', body: 'تم فتح مراجعة على المشروع وسيتم متابعة التفاصيل من الإدارة.' },
    };
    return messages[row.action] ?? { title: 'تحديث جديد في المشروع', body: 'حصل تحديث مهم داخل المشروع. افتحه لمراجعة التفاصيل.' };
  }
}
