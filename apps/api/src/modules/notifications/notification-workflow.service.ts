import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { computeCriticalOfferCheckpoints } from './critical-offer-checkpoints.util';
import { NotificationTypeConfig, NotificationPriorityTier } from './entities/notification-type-config.entity';
import { NotificationWorkflow } from './entities/notification-workflow.entity';
import { computeScheduledJobCheckpoints } from './scheduled-job-checkpoints.util';

const ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK = 60;
const ACTION_REQUIRED_MAX_REMINDERS_FALLBACK = 24;
const SCHEDULED_JOB_AFTER_MINUTES_FALLBACK = 60;
const SCHEDULED_JOB_DAY_BEFORE_HOUR_UTC_FALLBACK = 8;
const SCHEDULED_JOB_PRE_APPOINTMENT_MINUTES_FALLBACK = 120;
// نِسَب موضع التذكير جوّه نافذة عرض الطوارئ (docs/08 §17.16) — [0.5, 0.85] افتراضي تطويري:
// تذكير في نص المهلة، وتذكير أخير قرب الانتهاء. قابلة للتعديل الكامل من `/settings`.
const CRITICAL_OFFER_REMINDER_RATIOS_FALLBACK = [0.5, 0.85];

export interface CreateWorkflowInput {
  userId: string;
  notificationType: string;
  titleAr: string;
  bodyAr: string;
  entityType?: string;
  entityId?: string;
  deepLink?: string;
  actionType?: string;
  expiresAt?: Date;
  /** الموعد المستهدف — لازم لـscheduled_job (checkpoints بتتحسب بالنسبة له)، متجاهل لأي تصنيف تاني. */
  targetAt?: Date;
}

// state machine عام لـaction_required/scheduled_job (ADR-0012) — إنشاء/حل/acknowledge لأي
// workflow. resolve()/acknowledge() الاتنين idempotent وآمنين تمامًا (safe no-op لو مفيش workflow
// مفتوح مطابق) — نفس فلسفة NotificationRoutingService.routeToRole() اللي مابترميش استثناء أبدًا،
// عشان استدعاءهم من نقطة اكتمال فعل موجودة (مثلاً OrderItemsService.approve()) ميكسرش العملية
// الأساسية لو حصل خطأ غير متوقع هنا.
@Injectable()
export class NotificationWorkflowService {
  private readonly logger = new Logger(NotificationWorkflowService.name);

  constructor(
    @InjectRepository(NotificationWorkflow) private readonly workflows: Repository<NotificationWorkflow>,
    @InjectRepository(NotificationTypeConfig) private readonly typeConfigs: Repository<NotificationTypeConfig>,
    private readonly settingsService: SettingsService,
  ) {}

  async create(input: CreateWorkflowInput): Promise<NotificationWorkflow> {
    const typeConfig = await this.typeConfigs.findOne({ where: { notificationType: input.notificationType } });
    const isScheduledJob = typeConfig?.priorityTier === NotificationPriorityTier.SCHEDULED_JOB;
    const isCriticalOffer = typeConfig?.priorityTier === NotificationPriorityTier.CRITICAL_OFFER;

    const createdAt = new Date();
    let nextReminderAt: Date | null;
    let maxReminders: number | null;

    if (isCriticalOffer && input.expiresAt) {
      const checkpoints = await this.criticalOfferCheckpoints(createdAt, input.expiresAt);
      nextReminderAt = checkpoints[0] ?? null;
      // زي scheduled_job بالظبط — طول قايمة الـcheckpoints نفسها هي الحد، مفيش max_reminders ثابت.
      maxReminders = null;
    } else if (isScheduledJob && input.targetAt) {
      const checkpoints = await this.scheduledJobCheckpoints(createdAt, input.targetAt);
      nextReminderAt = checkpoints[0] ?? null;
      // مفيش max_reminders ثابت هنا — طول قايمة الـcheckpoints نفسها هي الحد (بتتحسب من جديد
      // كل مرة في الـsweep، مش snapshot، عشان تغيير الإعداد يأثر على workflows الشغالة كمان).
      maxReminders = null;
    } else {
      const intervalMinutes = await this.settingsService.getNumber(
        'notification_engine.action_required_reminder_interval_minutes',
        ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK,
      );
      maxReminders = await this.settingsService.getNumber(
        'notification_engine.action_required_max_reminders',
        ACTION_REQUIRED_MAX_REMINDERS_FALLBACK,
      );
      nextReminderAt = new Date(createdAt.getTime() + intervalMinutes * 60_000);
    }

    const workflow = this.workflows.create({
      userId: input.userId,
      notificationType: input.notificationType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      titleAr: input.titleAr,
      bodyAr: input.bodyAr,
      deepLink: input.deepLink ?? null,
      requiresAction:
        typeConfig?.priorityTier === NotificationPriorityTier.ACTION_REQUIRED ||
        typeConfig?.priorityTier === NotificationPriorityTier.CRITICAL_OFFER,
      actionType: input.actionType ?? null,
      nextReminderAt,
      maxReminders,
      expiresAt: input.expiresAt ?? (isScheduledJob ? (input.targetAt ?? null) : null),
      targetAt: input.targetAt ?? null,
    });
    return this.workflows.save(workflow);
  }

  private async criticalOfferCheckpoints(sentAt: Date, expiresAt: Date): Promise<Date[]> {
    const ratios = await this.settingsService.getJson<number[]>(
      'notification_engine.critical_offer_reminder_ratios',
      CRITICAL_OFFER_REMINDER_RATIOS_FALLBACK,
    );
    return computeCriticalOfferCheckpoints(sentAt, expiresAt, ratios);
  }

  private async scheduledJobCheckpoints(createdAt: Date, targetAt: Date): Promise<Date[]> {
    const [afterMinutes, dayBeforeHourUtc, preAppointmentMinutes] = await Promise.all([
      this.settingsService.getNumber(
        'notification_engine.scheduled_job_reminder_after_minutes',
        SCHEDULED_JOB_AFTER_MINUTES_FALLBACK,
      ),
      this.settingsService.getNumber(
        'notification_engine.scheduled_job_day_before_hour_utc',
        SCHEDULED_JOB_DAY_BEFORE_HOUR_UTC_FALLBACK,
      ),
      this.settingsService.getNumber(
        'notification_engine.scheduled_job_pre_appointment_minutes',
        SCHEDULED_JOB_PRE_APPOINTMENT_MINUTES_FALLBACK,
      ),
    ]);
    return computeScheduledJobCheckpoints(createdAt, targetAt, { afterMinutes, dayBeforeHourUtc, preAppointmentMinutes });
  }

  /** بيحل كل الـworkflows المفتوحة المطابقة (مش واحد بس) — نادرًا أكتر من واحد بس ممكن نظريًا (مثلاً اقتراح بنود متكرر قبل حل الأول). */
  async resolve(entityType: string, entityId: string, actionType?: string, notificationType?: string): Promise<void> {
    try {
      const where: Record<string, unknown> = { entityType, entityId, resolvedAt: IsNull() };
      if (actionType) where.actionType = actionType;
      if (notificationType) where.notificationType = notificationType;
      await this.workflows.update(where, { resolvedAt: new Date(), nextReminderAt: null });
    } catch (err) {
      this.logger.error(`فشل حل notification_workflow لـ ${entityType}/${entityId}`, err instanceof Error ? err.stack : err);
    }
  }

  async acknowledge(entityType: string, entityId: string): Promise<void> {
    try {
      await this.workflows.update({ entityType, entityId, acknowledgedAt: IsNull() }, { acknowledgedAt: new Date() });
    } catch (err) {
      this.logger.error(`فشل acknowledge notification_workflow لـ ${entityType}/${entityId}`, err instanceof Error ? err.stack : err);
    }
  }

  /** بتتنادى من NotificationsService.markRead() لما صف notifications مرتبط بـworkflow معيّن يتقرا. */
  async acknowledgeById(workflowId: string): Promise<void> {
    try {
      await this.workflows.update({ id: workflowId, acknowledgedAt: IsNull() }, { acknowledgedAt: new Date() });
    } catch (err) {
      this.logger.error(`فشل acknowledge notification_workflow ${workflowId}`, err instanceof Error ? err.stack : err);
    }
  }
}
