import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYMENT_INSTAPAY_CONFIRMED_EVENT, PaymentInstaPayConfirmedEvent } from '../../../common/events/payment-instapay-confirmed.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

// §28 — نظير PaymentInstaPayRejectedNotificationListener بالحرف بس للمسار العكسي. كانت فجوة
// حقيقية: العميل كان بيعرف إن الدفع اتأكّد بس من إشعار حالة الطلب العام (order.status_changed)،
// اللي مش دايمًا واضح إنه بالتحديد "دفعتك اتأكّدت" — تجربة مربكة مقارنة برسالة الرفض الواضحة.
@Injectable()
export class PaymentInstaPayConfirmedNotificationListener {
  private readonly logger = new Logger(PaymentInstaPayConfirmedNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(PAYMENT_INSTAPAY_CONFIRMED_EVENT)
  async handle(event: PaymentInstaPayConfirmedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'payment_instapay_confirmed',
        titleAr: 'تحويلك عبر InstaPay اتأكّد ✅',
        bodyAr: 'استلمنا تحويلك وأكّدنا الدفع — طلبك بيتابع دلوقتي.',
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تأكيد InstaPay ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
