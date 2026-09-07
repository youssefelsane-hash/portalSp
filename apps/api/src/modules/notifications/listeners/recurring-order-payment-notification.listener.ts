import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RECURRING_CARD_PAYMENT_FAILED_EVENT,
  RECURRING_CASH_REMINDER_EVENT,
  RecurringCardPaymentFailedEvent,
  RecurringCashReminderEvent,
} from '../../../common/events/recurring-order-payment.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class RecurringOrderPaymentNotificationListener {
  private readonly logger = new Logger(RecurringOrderPaymentNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(RECURRING_CARD_PAYMENT_FAILED_EVENT)
  async notifyCardFailure(event: RecurringCardPaymentFailedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const title = event.cancelled ? 'تم إلغاء الحجز المتكرر بسبب فشل الدفع' : 'لم نتمكن من سحب قيمة الحجز المتكرر';
      const body = event.cancelled
        ? `الحجز ${event.orderNumber} اتلغى بعد 3 محاولات فاشلة. حدّث بطاقتك وأنشئ حجزًا جديدًا إذا ما زلت تحتاج الخدمة.`
        : `محاولة ${event.attemptNumber} من 3 للحجز ${event.orderNumber} لم تنجح. تأكد من البطاقة أو حدّث وسيلة الدفع؛ سنحاول مرة أخرى قبل الموعد.`;
      await this.notifications.notify({
        userId: customer.userId,
        notificationType: 'recurring_card_payment_failed',
        titleAr: title,
        bodyAr: body,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تحصيل النوبة المتكررة ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }

  @OnEvent(RECURRING_CASH_REMINDER_EVENT)
  async notifyCashReminder(event: RecurringCashReminderEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      const when = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(event.scheduledAt);
      const price = (event.totalAmountCents / 100).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await this.notifications.notify({
        userId: customer.userId,
        notificationType: 'recurring_cash_reminder',
        titleAr: 'تذكير بحجزك المتكرر',
        bodyAr: `الفني هيوصلك ${when}. قيمة الزيارة ${price} ج.م، وحجزك ما زال مؤكدًا.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل تذكير الكاش للنوبة المتكررة ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
