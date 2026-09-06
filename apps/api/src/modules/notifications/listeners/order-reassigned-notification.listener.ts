import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_REASSIGNED_EVENT, OrderReassignedEvent } from '../../../common/events/order-reassigned.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderReassignedNotificationListener {
  private readonly logger = new Logger(OrderReassignedNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_REASSIGNED_EVENT)
  async handleOrderReassigned(event: OrderReassignedEvent): Promise<void> {
    try {
      const technician = await this.techniciansService.findByProfileIdOrThrow(event.newTechnicianProfileId);
      await this.notificationsService.notify({
        userId: technician.userId,
        notificationType: 'order_reassigned_to_you',
        titleAr: 'الإدارة عيّنتلك طلب',
        bodyAr: `طلب رقم ${event.orderNumber} اتعيّن ليك مباشرة من فريق العمليات.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/technician/orders/${event.orderId}`,
      });
      if (event.previousTechnicianProfileId && event.previousTechnicianProfileId !== event.newTechnicianProfileId) {
        const previousTechnician = await this.techniciansService.findByProfileIdOrThrow(event.previousTechnicianProfileId);
        await this.notificationsService.notify({
          userId: previousTechnician.userId,
          notificationType: 'order_reassigned_away',
          titleAr: 'الإدارة نقلت الطلب لفني آخر',
          bodyAr: `طلب رقم ${event.orderNumber} لم يعد ضمن طلباتك.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(`فشل إشعار تعيين الطلب ${event.orderId} يدوياً`, err instanceof Error ? err.stack : err);
    }
  }
}
