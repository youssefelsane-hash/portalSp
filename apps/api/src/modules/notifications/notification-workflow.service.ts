import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { NotificationWorkflow } from './entities/notification-workflow.entity';

const ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK = 60;
const ACTION_REQUIRED_MAX_REMINDERS_FALLBACK = 24;

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
    private readonly settingsService: SettingsService,
  ) {}

  async create(input: CreateWorkflowInput): Promise<NotificationWorkflow> {
    const intervalMinutes = await this.settingsService.getNumber(
      'notification_engine.action_required_reminder_interval_minutes',
      ACTION_REQUIRED_REMINDER_INTERVAL_MINUTES_FALLBACK,
    );
    const maxReminders = await this.settingsService.getNumber(
      'notification_engine.action_required_max_reminders',
      ACTION_REQUIRED_MAX_REMINDERS_FALLBACK,
    );

    const workflow = this.workflows.create({
      userId: input.userId,
      notificationType: input.notificationType,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      titleAr: input.titleAr,
      bodyAr: input.bodyAr,
      deepLink: input.deepLink ?? null,
      requiresAction: true,
      actionType: input.actionType ?? null,
      nextReminderAt: new Date(Date.now() + intervalMinutes * 60_000),
      maxReminders,
      expiresAt: input.expiresAt ?? null,
    });
    return this.workflows.save(workflow);
  }

  /** بيحل كل الـworkflows المفتوحة المطابقة (مش واحد بس) — نادرًا أكتر من واحد بس ممكن نظريًا (مثلاً اقتراح بنود متكرر قبل حل الأول). */
  async resolve(entityType: string, entityId: string, actionType?: string): Promise<void> {
    try {
      const where: Record<string, unknown> = { entityType, entityId, resolvedAt: IsNull() };
      if (actionType) where.actionType = actionType;
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
