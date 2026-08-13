import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ASSISTANT_PERSONAL_ASSIGNED_EVENT,
  AssistantPersonalAssignedEvent,
} from '../../../common/events/assistant-personal-assigned.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// مطابقة المساعد التلقائية (ADR-0007) — أولوية 1: المساعد الشخصي اتعيّن مباشرة، يستاهل يعرف.
@Injectable()
export class AssistantPersonalAssignedNotificationListener {
  private readonly logger = new Logger(AssistantPersonalAssignedNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ASSISTANT_PERSONAL_ASSIGNED_EVENT)
  async handle(event: AssistantPersonalAssignedEvent): Promise<void> {
    try {
      const assistant = await this.techniciansService.findByProfileIdOrThrow(event.assistantTechnicianId);
      await this.notificationsService.notify({
        userId: assistant.userId,
        notificationType: 'assistant_assigned',
        titleAr: 'اتعيّنت كمساعد على طلب',
        bodyAr: 'الفني اللي مرتبط بيك طلب مساعدته على شغلانة — اتأكد إنك جاهز.',
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/technician/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار تعيين المساعد الشخصي لطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
