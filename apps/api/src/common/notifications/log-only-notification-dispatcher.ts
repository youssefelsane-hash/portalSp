import { Injectable, Logger } from '@nestjs/common';
import { DispatchNotificationInput, DispatchResult, NotificationDispatcher } from './notification-dispatcher';

// لا يوجد اتصال إنترنت خارجي في بيئة التطوير دي، فمفيش بوابة FCM/SMS/SMTP حقيقية لسه —
// ده بديل صريح وموثّق (مش وهمي بصمت): بيسجّل الإشعار في اللوج وبيعتبره "delivered" فوراً،
// وبيفشل بوضوح لو مفيش أي target (زي ما هيحصل مع بوابة حقيقية لمستخدم من غير جهاز مسجّل).
// الاستبدال ببوابة حقيقية = تنفيذ تاني لـ NotificationDispatcher + تغيير الـ provider في notifications.module.ts فقط.
@Injectable()
export class LogOnlyNotificationDispatcher implements NotificationDispatcher {
  private readonly logger = new Logger('NotificationDispatch(log-only)');

  async dispatch(input: DispatchNotificationInput): Promise<DispatchResult> {
    if (input.channel !== 'in_app' && input.targets.length === 0) {
      return { delivered: false, failureReason: 'لا يوجد جهاز/بريد/رقم مسجّل لهذا المستخدم على هذه القناة' };
    }

    this.logger.log(
      `[${input.channel}] → user=${input.userId} targets=${input.targets.length || 'n/a'} :: ${input.titleAr}`,
    );
    return { delivered: true, failureReason: null };
  }
}
