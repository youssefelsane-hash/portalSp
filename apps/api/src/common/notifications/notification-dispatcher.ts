import { NotificationChannel } from '../../modules/notifications/entities/notification.entity';
import { NotificationPriorityTier } from '../../modules/notifications/entities/notification-type-config.entity';

export interface DispatchNotificationInput {
  /**
   * معرّف صف `notifications` اللي الإرسال ده بتاعه — بيتبعت مع حمولة الدفع عشان الجهاز يقدر
   * يأكّد الاستلام (`POST /notifications/delivered`، تدقيق L-7). من غيره الحالة `delivered`
   * ماكانش ليها أي طريقة تتحقّق: FCM بيأكّد إنه *قبل* الرسالة، مش إنها وصلت الجهاز.
   *
   * `null` للإرسال اللي مالوش صف `notifications` أصلاً — حالة واحدة بس: كود التحقق (OTP)
   * بيتبعت SMS مباشرة قبل ما يكون فيه مستخدم أساسًا، فمفيش استلام يتأكّد.
   */
  notificationId: string | null;
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
