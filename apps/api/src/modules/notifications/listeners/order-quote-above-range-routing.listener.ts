import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT,
  OrderQuoteAboveRangeSubmittedEvent,
} from '../../../common/events/order-quote-above-range-submitted.event';
import { NotificationRoutingService } from '../notification-routing.service';

/** قرش → جنيه للعرض في نص الإشعار — نفس تنسيق `refund-notification.listener.ts`. */
function egp(amountCents: number): string {
  return (amountCents / 100).toFixed(2).replace(/\.00$/, '');
}

/**
 * ADR-0067 §1 — سعر خارج النطاق اتحجز في `pending_admin_review`.
 *
 * القرار ده مش انتقال حالة، فماكانش فيه أي حدث يوصل للأدمن: طابور «طلبات التقييم» كان قناة
 * الاكتشاف الوحيدة، والفني في مكان العميل مستني قرار. نفس نمط
 * `OrderCrewShortageEscalatedRoutingListener` (routeToRole الموجود، مفيش نظام توجيه موازي).
 */
@Injectable()
export class OrderQuoteAboveRangeRoutingListener {
  private readonly logger = new Logger(OrderQuoteAboveRangeRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT)
  async handle(event: OrderQuoteAboveRangeSubmittedEvent): Promise<void> {
    try {
      const rangeText =
        event.expectedMaxCents === null
          ? 'أعلى من آخر سعر معتمد على الطلب'
          : `أعلى من سقف النطاق المعروض للعميل (${egp(event.expectedMaxCents)} ج.م)`;

      await this.routingService.routeToRole('order.quote_above_range_submitted', {
        notificationType: 'order_quote_above_range_submitted',
        titleAr: `سعر خارج النطاق يستنى قرارك: ${event.orderNumber}`,
        bodyAr: `السعر المطلوب ${egp(event.amountCents)} ج.م — ${rangeText}. العميل ماشافوش، والطلب واقف لحد ما تعتمد أو ترفض.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(
        `فشل توجيه إشعار سعر خارج النطاق للطلب ${event.orderId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
