import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../../common/events/order-accepted.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderAcceptedNotificationListener {
  private readonly logger = new Logger(OrderAcceptedNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_ACCEPTED_EVENT)
  async handleOrderAccepted(event: OrderAcceptedEvent): Promise<void> {
    try {
      const [customer, technician] = await Promise.all([
        this.customerProfiles.findByProfileIdOrThrow(event.customerId),
        this.techniciansService.findByProfileIdOrThrow(event.technicianId),
      ]);

      await Promise.all([
        this.notificationsService.notify({
          userId: customer.userId,
          notificationType: 'order_accepted',
          titleAr: 'فني قبل طلبك',
          bodyAr: 'فني قبل طلبك وبيجهّز يتحرّك — تقدر تتابع الموقع لحظياً.',
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        }),
        this.notificationsService.notify({
          userId: technician.userId,
          notificationType: 'order_assigned',
          titleAr: 'طلب جديد اتأكّد',
          bodyAr: 'قبلت طلب جديد بنجاح — جهّز نفسك وتحرّك.',
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        }),
      ]);
    } catch (err) {
      this.logger.error(`فشل إشعار قبول الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
