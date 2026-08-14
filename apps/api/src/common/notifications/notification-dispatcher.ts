import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';
import { NotificationPriorityTier } from '../../modules/notifications/entities/notification-type-config.entity';

export interface DispatchNotificationInput {
  userId: string;
  channel: NotificationChannel;
  titleAr: string;
  bodyAr: string;
  deepLink: string | null;
  /** بيانات دفع فعلية (fcm tokens, بريد, رقم) — بيتحدد بمعرفة NotificationsService قبل النداء. */
  targets: string[];
  notificationType: string;
  /** من NotificationTypeConfig — undefined لو مفيش صف للنوع ده (سلوك افتراضي عادي، مش أولوية). docs/08 §17.16 */
  priorityTier?: NotificationPriorityTier;
  soundKey?: string | null;
  isActionable?: boolean;
  actionLabels?: Record<string, string> | null;
}

export interface DispatchResult {
  delivered: boolean;
  failureReason: string | null;
}

/** بوابة الإرسال الفعلي (FCM / SMS gateway / SMTP / WhatsApp Business API) — قابلة للتبديل زي StorageService. */
export interface NotificationDispatcher {
  dispatch(input: DispatchNotificationInput): Promise<DispatchResult>;
}

export const NOTIFICATION_DISPATCHER = Symbol('NOTIFICATION_DISPATCHER');
