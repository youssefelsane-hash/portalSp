import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_ACCEPTED_EVENT, OrderAcceptedEvent } from '../../../common/events/order-accepted.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationWorkflowService } from '../notification-workflow.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderAcceptedNotificationListener {
  private readonly logger = new Logger(OrderAcceptedNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
    private readonly workflowService: NotificationWorkflowService,
  ) {}

  @OnEvent(ORDER_ACCEPTED_EVENT)
  async handleOrderAccepted(event: OrderAcceptedEvent): Promise<void> {
    try {
      const [customer, technician] = await Promise.all([
        this.customerProfiles.findByProfileIdOrThrow(event.customerId),
        this.techniciansService.findByProfileIdOrThrow(event.technicianId),
      ]);

      // موعد مستقبلي محجوز مقدمًا (Scheduler) — scheduled_job (ADR-0012، docs/08 §15)، مختلف عن
      // order_assigned العادي لطلبات ASAP (صفر تغيير سلوكي ليه). الـworkflow بيتعمل قبل الإرسال
      // الأول عشان حتى إشعار القبول الأول يترتبط بيه (نفس نمط order_quote_pending_approval).
      const isScheduled = event.scheduledAt !== null;
      const technicianWorkflow = isScheduled
        ? await this.workflowService.create({
            userId: technician.userId,
            notificationType: 'order_assigned_scheduled',
            titleAr: 'طلب جديد اتأكّد — موعد مستقبلي',
            bodyAr: 'قبلت طلب جديد بموعد محدد — جهّز نفسك للموعد ده.',
            entityType: 'order',
            entityId: event.orderId,
            deepLink: `/technician/orders/${event.orderId}`,
            targetAt: event.scheduledAt!,
          })
        : null;

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
          notificationType: isScheduled ? 'order_assigned_scheduled' : 'order_assigned',
          titleAr: isScheduled ? 'طلب جديد اتأكّد — موعد مستقبلي' : 'طلب جديد اتأكّد',
          bodyAr: isScheduled ? 'قبلت طلب جديد بموعد محدد — جهّز نفسك للموعد ده.' : 'قبلت طلب جديد بنجاح — جهّز نفسك وتحرّك.',
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
          workflowId: technicianWorkflow?.id,
        }),
      ]);
    } catch (err) {
      this.logger.error(`فشل إشعار قبول الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
