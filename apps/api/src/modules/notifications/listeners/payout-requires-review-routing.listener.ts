import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PAYOUT_REQUIRES_REVIEW_EVENT, PayoutRequiresReviewEvent } from '../../../common/events/payout-requires-review.event';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class PayoutRequiresReviewRoutingListener {
  private readonly logger = new Logger(PayoutRequiresReviewRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(PAYOUT_REQUIRES_REVIEW_EVENT)
  async handlePayoutRequiresReview(event: PayoutRequiresReviewEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(PAYOUT_REQUIRES_REVIEW_EVENT, {
        notificationType: 'payout_requires_review',
        titleAr: `طلب صرف محتاج مراجعة: ${event.payoutNumber}`,
        bodyAr: `قيمة الطلب ${event.amountCents / 100} جنيه — أعلى من حد الموافقة التلقائية.`,
        referenceType: 'payout',
        referenceId: event.payoutId,
        deepLink: `/admin/payouts/${event.payoutId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار الصرف ${event.payoutId}`, err instanceof Error ? err.stack : err);
    }
  }
}
