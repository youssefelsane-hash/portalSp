import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RECURRING_ORDER_AWAITING_PAYMENT_EVENT,
  RecurringOrderAwaitingPaymentEvent,
} from '../../../common/events/recurring-order-awaiting-payment.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { NotificationsService } from '../notifications.service';

// نفس نمط OrderCreatedNotificationListener بالحرف — إشعار مباشر للعميل (fire-and-forget آمن:
// فشل الإشعار مايرجّعش التوليد ولا يكسر حاجة).
@Injectable()
export class RecurringOrderAwaitingPaymentNotificationListener {
  private readonly logger = new Logger(RecurringOrderAwaitingPaymentNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(RECURRING_ORDER_AWAITING_PAYMENT_EVENT)
  async handleRecurringOrderAwaitingPayment(event: RecurringOrderAwaitingPaymentEvent): Promise<void> {
    try {
      const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'recurring_order_awaiting_payment',
        titleAr: 'طلبك المتكرر جاهز — كمّل الدفع',
        bodyAr: `الحجز المتكرر بتاعك ولّد طلب جديد رقم ${event.orderNumber} — لازم تدفع إلكتروني قبل ما يبدأ البحث عن فني، وإلا هيتلغى تلقائيًا بعد مهلة الدفع.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(
        `فشل إشعار انتظار الدفع للطلب المتكرر ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
