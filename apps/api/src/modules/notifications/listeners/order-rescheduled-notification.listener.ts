import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_RESCHEDULED_EVENT, OrderRescheduledEvent } from '../../../common/events/order-rescheduled.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationChannel } from '../entities/notification.entity';
import { NotificationsService } from '../notifications.service';

// إشعار عالي الوضوح للفني (in_app + push، مش in_app بس) — docs/08 §22 بند 9-12 نص صراحة على
// "إشعار الفني بشكل واضح" لأنه بيغيّر خطة يومه.
@Injectable()
export class OrderRescheduledNotificationListener {
  private readonly logger = new Logger(OrderRescheduledNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_RESCHEDULED_EVENT)
  async handle(event: OrderRescheduledEvent): Promise<void> {
    try {
      const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianProfileId);
      const newTimeAr = event.newScheduledAt.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' });
      await this.notificationsService.notifyMultiChannel(
        {
          userId: technician.userId,
          notificationType: 'order_rescheduled',
          titleAr: 'العميل غيّر ميعاد الطلب',
          bodyAr: `طلب رقم ${event.orderNumber} اتغيّر ميعاده لـ ${newTimeAr}`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        },
        [NotificationChannel.IN_APP, NotificationChannel.PUSH],
      );
    } catch (err) {
      this.logger.error(`فشل إشعار إعادة جدولة الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
