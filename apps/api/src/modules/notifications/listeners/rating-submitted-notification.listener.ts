import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RATING_SUBMITTED_EVENT, RatingSubmittedEvent } from '../../../common/events/rating-submitted.event';
import { RatingType } from '../../ratings/entities/rating.entity';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class RatingSubmittedNotificationListener {
  private readonly logger = new Logger(RatingSubmittedNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(RATING_SUBMITTED_EVENT)
  async handleRatingSubmitted(event: RatingSubmittedEvent): Promise<void> {
    try {
      const isTechnicianRated = event.ratingType === RatingType.CUSTOMER_TO_TECHNICIAN;
      const deepLink = isTechnicianRated ? `/technician/orders/${event.orderId}` : `/orders/${event.orderId}`;

      await this.notificationsService.notify({
        userId: event.ratedUserId,
        notificationType: 'rating_received',
        titleAr: 'استلمت تقييم جديد',
        bodyAr: `اتقيّمت بـ ${event.overallRating} من 5 نجوم على الطلب.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تقييم جديد للتقييم ${event.ratingId}`, err instanceof Error ? err.stack : err);
    }
  }
}
