import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT,
  PaymentInstaPayTransferReportedEvent,
} from '../../../common/events/payment-instapay-transfer-reported.event';
import { NotificationRoutingService } from '../notification-routing.service';

// §28 — فجوة رصد حقيقية: العميل بيدوس "حوّلت" وده كان بيتسجّل بلا أي تنبيه فعلي لفريق Finance
// (نفس نمط PayoutRequiresReviewRoutingListener/SupportChatMessageRoutingListener بالحرف).
@Injectable()
export class PaymentInstaPayTransferReportedRoutingListener {
  private readonly logger = new Logger(PaymentInstaPayTransferReportedRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT)
  async handle(event: PaymentInstaPayTransferReportedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT, {
        notificationType: 'payment_instapay_transfer_reported',
        titleAr: `عميل بلّغ تحويل InstaPay: ${event.orderNumber}`,
        bodyAr: `قيمة ${(event.amountCents / 100).toFixed(2)} ج.م — محتاج مراجعة وتأكيد.`,
        referenceType: 'payment',
        referenceId: event.paymentId,
        deepLink: `/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار تبليغ تحويل InstaPay ${event.paymentId}`, err instanceof Error ? err.stack : err);
    }
  }
}
