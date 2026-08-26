import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';
import { NOTIFICATION_DISPATCHER, NotificationDispatcher } from '../../common/notifications/notification-dispatcher';
import { User } from '../auth/entities/user.entity';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { Notification, NotificationChannel, NotificationDeliveryStatus } from './entities/notification.entity';
import { NotificationTypeConfig } from './entities/notification-type-config.entity';
import { UserDevice } from './entities/user-device.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationWorkflowService } from './notification-workflow.service';

// القنوات القابلة للتعطيل من تفضيلات المستخدم — in_app مستثناة عمدًا (صندوق الإشعارات نفسه
// جوّه التطبيق، مفيش معنى تعطيله).
export const PREFERENCE_ELIGIBLE_CHANNELS = [
  NotificationChannel.PUSH,
  NotificationChannel.SMS,
  NotificationChannel.WHATSAPP,
  NotificationChannel.EMAIL,
] as const;

export interface NotifyInput {
  userId: string;
  notificationType: string;
  titleAr: string;
  bodyAr: string;
  referenceType?: string;
  referenceId?: string;
  deepLink?: string;
  /** بيربط صف التسليم بالـNotificationWorkflow اللي ولّده (ADR-0012) — اختياري، مفيش أثر على الإرسال العادي. */
  workflowId?: string;
  /** Durable-event source. One row per user/channel makes retries idempotent. */
  sourceOutboxId?: string;
}

export interface ListNotificationsParams {
  page: number;
  perPage: number;
  unreadOnly: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(UserDevice) private readonly devices: Repository<UserDevice>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserNotificationPreference)
    private readonly preferences: Repository<UserNotificationPreference>,
    @InjectRepository(NotificationTypeConfig) private readonly typeConfigs: Repository<NotificationTypeConfig>,
    @Inject(NOTIFICATION_DISPATCHER) private readonly dispatcher: NotificationDispatcher,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  // ── الأجهزة ──────────────────────────────────────────────────────────

  /** لو device_id مسجّل قبل كده لمستخدم تاني (تسجيل خروج/دخول بحساب مختلف على نفس الموبايل)، بننقل ملكيته للمستخدم الحالي. */
  async registerDevice(userId: string, dto: RegisterDeviceDto): Promise<UserDevice> {
    let device = await this.devices.findOne({ where: { deviceId: dto.device_id } });

    if (!device) {
      device = this.devices.create({ deviceId: dto.device_id, userId });
    } else if (device.userId !== userId) {
      this.logger.warn(`جهاز ${dto.device_id} اتنقل من مستخدم ${device.userId} لمستخدم ${userId}`);
      device.userId = userId;
    }

    device.fcmToken = dto.fcm_token ?? null;
    device.platform = dto.platform;
    device.osVersion = dto.os_version ?? null;
    device.appVersion = dto.app_version ?? null;
    device.deviceModel = dto.device_model ?? null;
    device.isActive = true;
    device.lastActiveAt = new Date();

    return this.devices.save(device);
  }

  async deactivateDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.devices.findOne({ where: { deviceId, userId } });
    if (!device) {
      throw new ApiException(ErrorCode.VAL_001, 'الجهاز غير موجود', HttpStatus.NOT_FOUND);
    }
    device.isActive = false;
    await this.devices.save(device);
  }

  // ── الإشعارات ────────────────────────────────────────────────────────

  /** بيسجّل الإشعار في القاعدة دايماً حتى لو فشل الإرسال الفعلي — الفشل بيتسجل في الصف نفسه، مش بيوقف تدفق العملية اللي استدعته. */
  async notify(input: NotifyInput, channel: NotificationChannel = NotificationChannel.IN_APP): Promise<Notification> {
    if (input.sourceOutboxId) {
      const existing = await this.notifications.findOne({
        where: { sourceOutboxId: input.sourceOutboxId, userId: input.userId, channel },
      });
      if (existing) return existing;
    }
    const notification = this.notifications.create({
      userId: input.userId,
      notificationType: input.notificationType,
      channel,
      titleAr: input.titleAr,
      bodyAr: input.bodyAr,
      deepLink: input.deepLink ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      workflowId: input.workflowId ?? null,
      sourceOutboxId: input.sourceOutboxId ?? null,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });
    await this.notifications.save(notification);

    // تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) — in_app دايماً بتتسجّل وتترسل، مفيش
    // تفضيل ليها أصلاً (راجع PREFERENCE_ELIGIBLE_CHANNELS). الصف اتسجّل فوق بالفعل (سجل دايم
    // في صندوق الإشعارات) حتى لو القناة الفعلية معطّلة — بس مفيش dispatch حقيقي هيتبعت.
    if (channel !== NotificationChannel.IN_APP && !(await this.isChannelEnabled(input.userId, channel))) {
      notification.deliveryStatus = NotificationDeliveryStatus.FAILED;
      notification.failureReason = 'المستخدم عطّل القناة دي من تفضيلاته';
      return this.notifications.save(notification);
    }

    const targets = await this.resolveTargets(input.userId, channel);
    // priority/sound/actionable من NotificationTypeConfig (docs/08 §17.16) — لو النوع مالوش صف،
    // undefined بيرجع بأمان (سلوك افتراضي عادي، نفس أي إشعار تاني قبل الميزة دي).
    const typeConfig = await this.typeConfigs.findOne({ where: { notificationType: input.notificationType } });

    try {
      const result = await this.dispatcher.dispatch({
        userId: input.userId,
        channel,
        titleAr: input.titleAr,
        bodyAr: input.bodyAr,
        deepLink: notification.deepLink,
        targets,
        notificationType: input.notificationType,
        priorityTier: typeConfig?.priorityTier,
        soundKey: typeConfig?.soundKey ?? null,
        isActionable: typeConfig?.isActionable ?? false,
        actionLabels: typeConfig?.actionLabels ?? null,
      });

      const now = new Date();
      if (result.delivered) {
        notification.deliveryStatus = NotificationDeliveryStatus.SENT;
        notification.sentAt = now;
      } else {
        notification.deliveryStatus = NotificationDeliveryStatus.FAILED;
        notification.failureReason = result.failureReason;
      }
    } catch (err) {
      // خطأ في بوابة الإرسال الخارجية مينفعش يفشّل العملية اللي استدعت notify() (طلب اتقبل، شكوى اتحلت، ...)
      notification.deliveryStatus = NotificationDeliveryStatus.FAILED;
      notification.failureReason = err instanceof Error ? err.message : 'خطأ غير معروف في الإرسال';
      this.logger.error(`فشل إرسال إشعار ${notification.id}`, err instanceof Error ? err.stack : err);
    }

    return this.notifications.save(notification);
  }

  /** نفس الحدث على أكتر من قناة (in_app مضمون دايماً + push/sms إضافي حسب توفر target) — كل قناة صف مستقل ومصيرها مستقل. */
  async notifyMultiChannel(input: NotifyInput, channels: NotificationChannel[]): Promise<Notification[]> {
    const uniqueChannels = Array.from(new Set(channels));
    const results: Notification[] = [];
    for (const channel of uniqueChannels) {
      results.push(await this.notify(input, channel));
    }
    return results;
  }

  private async resolveTargets(userId: string, channel: NotificationChannel): Promise<string[]> {
    switch (channel) {
      case NotificationChannel.IN_APP:
        return [];
      case NotificationChannel.PUSH: {
        const activeDevices = await this.devices.find({ where: { userId, isActive: true } });
        return activeDevices.map((d) => d.fcmToken).filter((token): token is string => !!token);
      }
      case NotificationChannel.SMS:
      case NotificationChannel.WHATSAPP: {
        const user = await this.users.findOne({ where: { id: userId } });
        return user ? [user.phoneNumber] : [];
      }
      case NotificationChannel.EMAIL: {
        const user = await this.users.findOne({ where: { id: userId } });
        return user?.email ? [user.email] : [];
      }
      default:
        return [];
    }
  }

  async listMine(
    userId: string,
    params: ListNotificationsParams,
  ): Promise<{ items: Notification[]; meta: { page: number; per_page: number; total: number } }> {
    const where = params.unreadOnly ? { userId, readAt: IsNull() } : { userId };

    const [items, total] = await this.notifications.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    });

    return { items, meta: { page: params.page, per_page: params.perPage, total } };
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await this.notifications.findOne({ where: { id: notificationId, userId } });
    if (!notification) {
      throw new ApiException(ErrorCode.VAL_001, 'الإشعار غير موجود', HttpStatus.NOT_FOUND);
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      notification.deliveryStatus = NotificationDeliveryStatus.READ;
      await this.notifications.save(notification);
      if (notification.workflowId) {
        await this.workflowService.acknowledgeById(notification.workflowId);
      }
    }
    return notification;
  }

  // Script 2 Part E (finding #26) — كانت بتقلب read_at بس بدون ما تعتمد (acknowledge) الـ
  // workflows المرتبطة، فنظام التذكيرات كان بيفضل يبعت تذكيرات لإشعارات المستخدم قراها فعلاً
  // عن طريق "قرا الكل". `.returning(['workflow_id'])` بيرجّع نفس الدفعة اللي اتحدّثت فقط —
  // مفيش استعلام إضافي منفصل.
  async markAllRead(userId: string): Promise<number> {
    const result = await this.notifications
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date(), deliveryStatus: NotificationDeliveryStatus.READ })
      .where('user_id = :userId AND read_at IS NULL', { userId })
      .returning(['workflowId'])
      .execute();

    const workflowIds = (result.raw as Array<{ workflow_id: string | null }>)
      .map((row) => row.workflow_id)
      .filter((id): id is string => id !== null);
    await this.workflowService.acknowledgeByIds(workflowIds);

    return result.affected ?? 0;
  }

  // ── تفضيلات إشعارات المستخدم بالقناة (docs/10 بند 37) ──────────────────

  private async isChannelEnabled(userId: string, channel: NotificationChannel): Promise<boolean> {
    const pref = await this.preferences.findOne({ where: { userId, channel } });
    // غياب الصف = مفعّل افتراضيًا (نفس فلسفة أي إعداد تاني في المشروع).
    return pref ? pref.isEnabled : true;
  }

  async listMyPreferences(userId: string): Promise<{ channel: NotificationChannel; isEnabled: boolean }[]> {
    const rows = await this.preferences.find({ where: { userId } });
    const byChannel = new Map(rows.map((r) => [r.channel, r.isEnabled]));
    return PREFERENCE_ELIGIBLE_CHANNELS.map((channel) => ({
      channel,
      isEnabled: byChannel.get(channel) ?? true,
    }));
  }

  async setMyPreference(userId: string, channel: NotificationChannel, isEnabled: boolean): Promise<void> {
    if (!(PREFERENCE_ELIGIBLE_CHANNELS as readonly NotificationChannel[]).includes(channel)) {
      throw new ApiException(ErrorCode.VAL_001, 'قناة إشعار مش قابلة للتعديل', HttpStatus.BAD_REQUEST);
    }
    const existing = await this.preferences.findOne({ where: { userId, channel } });
    if (existing) {
      existing.isEnabled = isEnabled;
      await this.preferences.save(existing);
    } else {
      await this.preferences.insert({ userId, channel, isEnabled });
    }
  }
}
