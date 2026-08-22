import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYMENT_INSTAPAY_REJECTED_EVENT, PaymentInstaPayRejectedEvent } from '../../../common/events/payment-instapay-rejected.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

// إكمال تدفق InstaPay اليدوي (ADR-0013 §7) — العميل لازم يعرف إن الأدمن رفض تحويله (سبب واضح)
// عشان يقدر يتصرف (يعيد التحويل صح، أو يختار وسيلة دفع تانية) بدل ما يفضل مستني تأكيد ماجيش.
@Injectable()
export class PaymentInstaPayRejectedNotificationListener {
  private readonly logger = new Logger(PaymentInstaPayRejectedNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(PAYMENT_INSTAPAY_REJECTED_EVENT)
  async handle(event: PaymentInstaPayRejectedEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'payment_instapay_rejected',
        titleAr: 'مقدرناش نأكّد تحويل InstaPay',
        bodyAr: `${event.reason} — تقدر تعيد التحويل صح أو تختار وسيلة دفع تانية.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار رفض InstaPay ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
