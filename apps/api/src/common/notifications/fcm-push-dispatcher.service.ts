import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging, MulticastMessage } from 'firebase-admin/messaging';
import { NotificationPriorityTier } from '../../modules/notifications/entities/notification-type-config.entity';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';

const HIGH_PRIORITY_TIERS: NotificationPriorityTier[] = [
  NotificationPriorityTier.CRITICAL_OFFER,
  NotificationPriorityTier.ACTION_REQUIRED,
];

/**
 * إشعارات push حقيقية عبر Firebase Cloud Messaging — نفس فلسفة كل الـ adapters التانية في
 * الجلسة دي (Paymob، S3): تفعيلها = ملء `FIREBASE_SERVICE_ACCOUNT_JSON` في `.env` (محتوى ملف
 * مفتاح خدمة Firebase الكامل كـJSON، تفاصيل الحصول عليه في docs/03-external-integrations.md)
 * من غير أي تعديل كود. `isConfigured=false` بيرفض بوضوح بدل ما ينهار أو يتظاهر بالنجاح.
 */
@Injectable()
export class FcmPushDispatcher {
  readonly isConfigured: boolean;
  private readonly logger = new Logger('NotificationDispatch(fcm)');
  private readonly messaging: Messaging | null;

  constructor(config: ConfigService) {
    const serviceAccountJson = config.get<string>('notifications.fcm.serviceAccountJson');
    if (!serviceAccountJson) {
      this.isConfigured = false;
      this.messaging = null;
      return;
    }

    try {
      const serviceAccount = JSON.parse(serviceAccountJson) as Record<string, string>;
      // getApps() بيمنع "app already exists" لو NestJS عمل instantiate للـ provider أكتر من مرة
      // (زي ما بيحصل مع StorageService — كل موديول بيستهلك NOTIFICATION_DISPATCHER بيجيب نسخته).
      const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
      this.messaging = getMessaging(app);
      this.isConfigured = true;
    } catch (err) {
      this.logger.error('فشل تحميل FIREBASE_SERVICE_ACCOUNT_JSON — لازم يكون JSON صحيح', err instanceof Error ? err.stack : err);
      this.isConfigured = false;
      this.messaging = null;
    }
  }

  async send(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (!this.isConfigured || !this.messaging) {
      return { delivered: false, failureReason: 'لا توجد بوابة push مُعدّة (FIREBASE_SERVICE_ACCOUNT_JSON)' };
    }
    if (input.targets.length === 0) {
      return { delivered: false, failureReason: 'لا يوجد جهاز مسجّل لهذا المستخدم' };
    }

    try {
      const result = await this.messaging.sendEachForMulticast(this.buildMessage(input));

      if (result.successCount === 0) {
        const firstError = result.responses.find((r) => !r.success)?.error?.message ?? 'فشل الإرسال لكل الأجهزة';
        return { delivered: false, failureReason: firstError };
      }
      // نجاح جزئي (بعض الأجهزة استلمت، بعضها فشل — توكن قديم مثلاً) لسه "delivered" — على الأقل
      // جهاز واحد استلم الإشعار، وده الهدف الفعلي.
      return { delivered: true, failureReason: null };
    } catch (err) {
      this.logger.error('فشل إرسال FCM', err instanceof Error ? err.stack : err);
      return { delivered: false, failureReason: err instanceof Error ? err.message : 'خطأ غير معروف في إرسال push' };
    }
  }

  /**
   * docs/08 §17.16 — إشعارات actionable (زي عرض طلب/طوارئ) بتتبعت **data-only** (بلا `notification`
   * block) عمدًا: أزرار قبول/رفض حقيقية جوّه الإشعار نفسه محتاجة إشعار محلي مبني على جهاز العميل
   * (flutter_local_notifications) — حمولة FCM القياسية `notification` مالهاش أزرار قابلة للتخصيص.
   * الأولوية العالية (Android `priority: 'high'` + APNs `apns-priority: '10'`) إجبارية هنا عشان
   * data-only messages توصل فورًا حتى لو التطبيق في الخلفية، مش لما الجهاز "يستريح" بعدين.
   * إشعارات عادية (informational مثلاً) بتفضل تستخدم `notification` block العادي — أبسط، بيشتغل
   * من غير أي كود Flutter إضافي في كل الحالات (foreground/background/terminated).
   */
  private buildMessage(input: DispatchNotificationInput): MulticastMessage {
    const isHighPriority = input.priorityTier ? HIGH_PRIORITY_TIERS.includes(input.priorityTier) : false;
    const androidPriority = isHighPriority ? ('high' as const) : ('normal' as const);
    const apnsPriority = isHighPriority ? '10' : '5';

    const baseData: Record<string, string> = {
      type: input.notificationType,
      ...(input.deepLink ? { deep_link: input.deepLink } : {}),
      ...(input.priorityTier ? { priority_tier: input.priorityTier } : {}),
      ...(input.soundKey ? { sound_key: input.soundKey } : {}),
      actionable: String(input.isActionable ?? false),
      ...(input.actionLabels ? { action_labels: JSON.stringify(input.actionLabels) } : {}),
    };

    if (input.isActionable) {
      // data-only — العميل هو المسؤول عن بناء الإشعار المحلي بالأزرار (title/body مبعوتين جوّه data).
      return {
        tokens: input.targets,
        data: { ...baseData, title: input.titleAr, body: input.bodyAr },
        android: { priority: androidPriority },
        apns: {
          headers: { 'apns-priority': apnsPriority, 'apns-push-type': 'alert' },
          payload: { aps: { 'content-available': 1, sound: input.soundKey ?? 'default' } },
        },
      };
    }

    return {
      tokens: input.targets,
      notification: { title: input.titleAr, body: input.bodyAr },
      data: baseData,
      android: {
        priority: androidPriority,
        notification: input.soundKey ? { sound: input.soundKey, channelId: input.priorityTier } : undefined,
      },
      apns: {
        headers: { 'apns-priority': apnsPriority },
        payload: { aps: { sound: input.soundKey ?? 'default' } },
      },
    };
  }
}
