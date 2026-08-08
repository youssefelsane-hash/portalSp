import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CASH_COLLECTED_EVENT, CashCollectedEvent } from '../../../common/events/cash-collected.event';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class CashCollectedRoutingListener {
  private readonly logger = new Logger(CashCollectedRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(CASH_COLLECTED_EVENT)
  async handleCashCollected(event: CashCollectedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(CASH_COLLECTED_EVENT, {
        notificationType: 'cash_collected',
        titleAr: `تحصيل كاش: طلب ${event.orderNumber}`,
        bodyAr: `الفني حصّل ${event.amountCents / 100} جنيه كاش من العميل.`,
        referenceType: 'payment',
        referenceId: event.paymentId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار تحصيل الكاش ${event.paymentId}`, err instanceof Error ? err.stack : err);
    }
  }
}
