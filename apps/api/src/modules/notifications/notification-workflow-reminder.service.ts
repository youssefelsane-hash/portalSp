import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { NotificationTypeConfig, NotificationPriorityTier } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { NotificationsService } from './notifications.service';
import { isWithinQuietHours, nextTimeOutsideQuietHours } from './quiet-hours.util';
import { computeScheduledJobCheckpoints } from './scheduled-job-checkpoints.util';

const SWEEP_INTERVAL_MS = 60_000;
const ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK = 60;
const SCHEDULED_JOB_AFTER_MINUTES_FALLBACK = 60;
const SCHEDULED_JOB_DAY_BEFORE_HOUR_UTC_FALLBACK = 8;
const SCHEDULED_JOB_PRE_APPOINTMENT_MINUTES_FALLBACK = 120;
const QUIET_HOURS_START_FALLBACK = '22:00';
const QUIET_HOURS_END_FALLBACK = '08:00';

/**
 * التكرار مُدار بالكامل من الباك-إند (ADR-0012) — فحص دوري (setInterval) بدل BullMQ delayed job
 * لكل workflow، بالظبط نفس قرار OrderAutoCancelService (`../orders/order-auto-cancel.service.ts`)
 * وبنفس السبب: action_required/scheduled_job ممكن يمتدوا لساعات/أيام، فاحتمالية التصادم مع انقطاع
 * Redis طويل أعلى بكتير من مهلة ثواني/دقائق زي matching rounds. الفحص الدوري هنا مستقل تمامًا:
 * بيعيد التقييم من Postgres مباشرة كل مرة، مفيش حالة متخزّنة في Redis ممكن "تعلق".
 */
@Injectable()
export class NotificationWorkflowReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkflowReminderService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(NotificationWorkflow) private readonly workflows: Repository<NotificationWorkflow>,
    @InjectRepository(NotificationTypeConfig) private readonly typeConfigs: Repository<NotificationTypeConfig>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.error('فشل sweep تذكيرات الإشعارات', err instanceof Error ? err.stack : err));
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const due = await this.workflows.find({
      select: ['id'],
      where: { nextReminderAt: LessThanOrEqual(new Date()) },
    });

    let sentCount = 0;
    for (const { id } of due) {
      const sent = await this.processOne(id);
      if (sent) sentCount++;
    }
    if (sentCount > 0) {
      this.logger.log(`تذكيرات الإشعارات: ${sentCount} تذكير اتبعت`);
    }
    return sentCount;
  }

  // قفل ذري لكل صف على حدة (pessimistic_write) — نفس نمط OrderAutoCancelService.cancelIfStillSearching().
  private async processOne(workflowId: string): Promise<boolean> {
    const now = new Date();

    const decision = await this.dataSource.transaction(async (manager) => {
      const workflow = await manager
        .createQueryBuilder(NotificationWorkflow, 'w')
        .setLock('pessimistic_write')
        .where('w.id = :workflowId', { workflowId })
        .getOne();

      // اتحل أو اتلغى بين لحظة الاستعلام والقفل — نفس مبدأ "no-op guard" في matching.service.ts.
      if (!workflow || workflow.resolvedAt || !workflow.nextReminderAt || workflow.nextReminderAt > now) {
        return null;
      }

      // انتهاء الصلاحية — بيوقف التكرار من غير ما يُعتبر "اتحل" فعليًا (resolved_at بيفضل NULL، تمييز منطقي).
      if (workflow.expiresAt && workflow.expiresAt <= now) {
        workflow.nextReminderAt = null;
        await manager.save(workflow);
        return null;
      }

      const typeConfig = await this.typeConfigs.findOne({ where: { notificationType: workflow.notificationType } });
      const isScheduledJob = typeConfig?.priorityTier === NotificationPriorityTier.SCHEDULED_JOB;

      // scheduled_job بيوقف بمجرد ما يتفتح (acknowledged_at) — مش محتاج "فعل" فعلي زي
      // action_required، بس ده بس لو requires_acknowledgment مفعّلة للنوع ده (قابل للتعديل).
      if (isScheduledJob && typeConfig?.requiresAcknowledgment && workflow.acknowledgedAt) {
        workflow.nextReminderAt = null;
        await manager.save(workflow);
        return null;
      }

      if (!isScheduledJob && workflow.maxReminders !== null && workflow.reminderCount >= workflow.maxReminders) {
        workflow.nextReminderAt = null;
        await manager.save(workflow);
        return null;
      }

      const quietStart = await this.settingsService.getString('notification_engine.quiet_hours_start', QUIET_HOURS_START_FALLBACK);
      const quietEnd = await this.settingsService.getString('notification_engine.quiet_hours_end', QUIET_HOURS_END_FALLBACK);

      // التذكير ده نفسه بيتأجل لو جوّه ساعات الهدوء دلوقتي — مش يتلغى، next_reminder_at بترجع
      // لأول لحظة برّه الهدوء (مفيش إرسال فعلي في الجولة دي، بس مش "استهلاك" لـreminder_count).
      if (isWithinQuietHours(now, quietStart, quietEnd)) {
        workflow.nextReminderAt = nextTimeOutsideQuietHours(now, quietStart, quietEnd);
        await manager.save(workflow);
        return null;
      }

      let nextAt: Date | null;
      if (isScheduledJob) {
        if (!workflow.targetAt) {
          // حالة نظرية بس (scheduled_job لازم يتعمل بـtargetAt دايمًا) — safe no-op بدل استثناء.
          workflow.nextReminderAt = null;
          await manager.save(workflow);
          return null;
        }
        const [afterMinutes, dayBeforeHourUtc, preAppointmentMinutes] = await Promise.all([
          this.settingsService.getNumber('notification_engine.scheduled_job_reminder_after_minutes', SCHEDULED_JOB_AFTER_MINUTES_FALLBACK),
          this.settingsService.getNumber('notification_engine.scheduled_job_day_before_hour_utc', SCHEDULED_JOB_DAY_BEFORE_HOUR_UTC_FALLBACK),
          this.settingsService.getNumber(
            'notification_engine.scheduled_job_pre_appointment_minutes',
            SCHEDULED_JOB_PRE_APPOINTMENT_MINUTES_FALLBACK,
          ),
        ]);
        // بتتحسب من جديد كل مرة (مش snapshot) — تغيير الإعداد بيأثر فورًا على workflows الشغالة.
        const checkpoints = computeScheduledJobCheckpoints(workflow.createdAt, workflow.targetAt, {
          afterMinutes,
          dayBeforeHourUtc,
          preAppointmentMinutes,
        });
        nextAt = checkpoints[workflow.reminderCount + 1] ?? null;
        if (nextAt) nextAt = nextTimeOutsideQuietHours(nextAt, quietStart, quietEnd);
      } else {
        const intervalMinutes = await this.settingsService.getNumber(
          'notification_engine.action_required_reminder_interval_minutes',
          ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK,
        );
        nextAt = nextTimeOutsideQuietHours(new Date(now.getTime() + intervalMinutes * 60_000), quietStart, quietEnd);
      }

      workflow.reminderCount += 1;
      workflow.nextReminderAt = nextAt;
      await manager.save(workflow);

      return { workflow };
    });

    if (!decision) return false;

    await this.notificationsService.notify({
      userId: decision.workflow.userId,
      notificationType: decision.workflow.notificationType,
      titleAr: decision.workflow.titleAr,
      bodyAr: decision.workflow.bodyAr,
      deepLink: decision.workflow.deepLink ?? undefined,
      referenceType: decision.workflow.entityType ?? undefined,
      referenceId: decision.workflow.entityId ?? undefined,
      workflowId: decision.workflow.id,
    });

    return true;
  }
}
