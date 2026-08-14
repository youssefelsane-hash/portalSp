import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_OFFER_RESOLVED_EVENT, OrderOfferResolvedEvent } from '../../../common/events/order-offer-resolved.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

/**
 * عرض طلب اتحل (docs/08 §17.16) — بيوقف أي دورة تذكير critical_offer شغالة فورًا (idempotent،
 * safe no-op للعروض العادية اللي مالهاش workflow أصلاً). لو السبب إن فني تاني قبل قبله، الفني
 * الخاسر ياخد إشعار فوري "العرض بقى مش متاح" بدل ما يفضل مستني رد لعرض راح فعلاً.
 */
@Injectable()
export class OrderOfferResolutionListener {
  private readonly logger = new Logger(OrderOfferResolutionListener.name);

  constructor(
    private readonly workflowService: NotificationWorkflowService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_OFFER_RESOLVED_EVENT)
  async handle(event: OrderOfferResolvedEvent): Promise<void> {
    try {
      await this.workflowService.resolve('order_assignment', event.assignmentId);

      if (event.resolution === 'cancelled_offer_taken') {
        const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
        await this.notificationsService.notify({
          userId: technician.userId,
          notificationType: 'order_offer_lost',
          titleAr: 'العرض بقى مش متاح',
          bodyAr: `طلب رقم ${event.orderNumber} — فني تاني قبله قبلك.`,
          referenceType: 'order_assignment',
          referenceId: event.assignmentId,
        });
      }
    } catch (err) {
      this.logger.error(`فشل معالجة حل عرض ${event.assignmentId}`, err instanceof Error ? err.stack : err);
    }
  }
}
