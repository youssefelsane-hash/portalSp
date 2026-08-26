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
      // docs/08 §68 (طلب مالك صريح): تقييم الفني للعميل بيبقى للأدمن بس — «العميل المفروض ما
      // يعرفش هو بيتقيّم». الإشعار ده كان بيقوله بالحرف «اتقيّمت بـ N من 5 نجوم»، فاتشال.
      // الأدمن لسه بيشوف التقييم: بث لحظي في AdminRealtimeGateway + بروفايل العميل (360).
      if (event.ratingType === RatingType.TECHNICIAN_TO_CUSTOMER) return;

      await this.notificationsService.notify({
        userId: event.ratedUserId,
        notificationType: 'rating_received',
        titleAr: 'استلمت تقييم جديد',
        bodyAr: `اتقيّمت بـ ${event.overallRating} من 5 نجوم على الطلب.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/technician/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تقييم جديد للتقييم ${event.ratingId}`, err instanceof Error ? err.stack : err);
    }
  }
}
