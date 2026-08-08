import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYOUT_COMPLETED_EVENT, PayoutCompletedEvent } from '../../../common/events/payout-completed.event';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class PayoutCompletedRoutingListener {
  private readonly logger = new Logger(PayoutCompletedRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(PAYOUT_COMPLETED_EVENT)
  async handlePayoutCompleted(event: PayoutCompletedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(PAYOUT_COMPLETED_EVENT, {
        notificationType: 'payout_completed',
        titleAr: `صرف اتقفل: ${event.payoutNumber}`,
        bodyAr: `اتحول ${event.netAmountCents / 100} جنيه فعلياً لمحفظة الفني.`,
        referenceType: 'payout',
        referenceId: event.payoutId,
        deepLink: `/admin/payouts/${event.payoutId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار قفل الصرف ${event.payoutId}`, err instanceof Error ? err.stack : err);
    }
  }
}
