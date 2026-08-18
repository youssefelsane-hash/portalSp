import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_CREW_CHANGED_EVENT, OrderCrewChangedEvent } from '../../../common/events/order-crew-changed.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) — نفس فلسفة
// order-assistant-assigned-manually-notification.listener.ts بس عام لأي عضو طاقم (مش مساعد بس).
@Injectable()
export class OrderCrewChangedNotificationListener {
  private readonly logger = new Logger(OrderCrewChangedNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_CREW_CHANGED_EVENT)
  async handle(event: OrderCrewChangedEvent): Promise<void> {
    try {
      if (event.addedTechnicianProfileId) {
        const added = await this.techniciansService.findByProfileIdOrThrow(event.addedTechnicianProfileId);
        await this.notificationsService.notify({
          userId: added.userId,
          notificationType: 'crew_member_added',
          titleAr: 'اتضفت لفريق طلب',
          bodyAr: 'الإدارة ضافتك لفريق طلب — اتأكد إنك جاهز.',
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }
      if (event.removedTechnicianProfileId) {
        const removed = await this.techniciansService.findByProfileIdOrThrow(event.removedTechnicianProfileId);
        await this.notificationsService.notify({
          userId: removed.userId,
          notificationType: 'crew_member_removed',
          titleAr: 'اتشلت من فريق طلب',
          bodyAr: event.changeType === 'replaced' ? 'الإدارة استبدلتك بفني تاني في طلب كنت مضاف عليه.' : 'الإدارة شالتك من فريق طلب كنت مضاف عليه.',
          referenceType: 'order',
          referenceId: event.orderId,
        });
      }
    } catch (err) {
      this.logger.error(`فشل إشعار تغيير طاقم الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
