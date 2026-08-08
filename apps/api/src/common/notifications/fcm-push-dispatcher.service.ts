import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { DispatchNotificationInput, DispatchResult } from './notification-dispatcher';

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
      const result = await this.messaging.sendEachForMulticast({
        tokens: input.targets,
        notification: { title: input.titleAr, body: input.bodyAr },
        data: input.deepLink ? { deep_link: input.deepLink } : undefined,
      });

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
}
