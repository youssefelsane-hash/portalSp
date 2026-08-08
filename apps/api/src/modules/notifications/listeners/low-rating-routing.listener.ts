import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LOW_RATING_SUBMITTED_EVENT, LowRatingSubmittedEvent } from '../../../common/events/low-rating-submitted.event';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class LowRatingRoutingListener {
  private readonly logger = new Logger(LowRatingRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(LOW_RATING_SUBMITTED_EVENT)
  async handleLowRating(event: LowRatingSubmittedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole(LOW_RATING_SUBMITTED_EVENT, {
        notificationType: 'low_rating_submitted',
        titleAr: `تقييم منخفض (${event.overallRating}/5) على طلب`,
        bodyAr: event.comment ?? 'العميل قيّم الفني بتقييم منخفض من غير تعليق.',
        referenceType: 'rating',
        referenceId: event.ratingId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار التقييم المنخفض ${event.ratingId}`, err instanceof Error ? err.stack : err);
    }
  }
}
