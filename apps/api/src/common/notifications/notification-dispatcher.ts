import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';

export interface DispatchNotificationInput {
  userId: string;
  channel: NotificationChannel;
  titleAr: string;
  bodyAr: string;
  deepLink: string | null;
  /** بيانات دفع فعلية (fcm tokens, بريد, رقم) — بيتحدد بمعرفة NotificationsService قبل النداء. */
  targets: string[];
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
