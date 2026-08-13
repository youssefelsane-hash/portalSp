import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT,
  OrderAssistantAssignedManuallyEvent,
} from '../../../common/events/order-assistant-assigned-manually.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// تعيين مساعد يدوي من الأدمن بعد تصعيد (ADR-0008) — نفس فلسفة
// assistant-personal-assigned-notification.listener.ts (ADR-0007) بس برسالة مختلفة (اتعيّن من
// الإدارة، مش من قائد الطلب عبر ربط شخصي).
@Injectable()
export class OrderAssistantAssignedManuallyNotificationListener {
  private readonly logger = new Logger(OrderAssistantAssignedManuallyNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT)
  async handle(event: OrderAssistantAssignedManuallyEvent): Promise<void> {
    try {
      const assistant = await this.techniciansService.findByProfileIdOrThrow(event.assistantTechnicianProfileId);
      await this.notificationsService.notify({
        userId: assistant.userId,
        notificationType: 'assistant_assigned',
        titleAr: 'اتعيّنت كمساعد على طلب',
        bodyAr: 'الإدارة عيّنتك مساعدًا على طلب — اتأكد إنك جاهز.',
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/technician/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تعيين المساعد اليدوي لطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
