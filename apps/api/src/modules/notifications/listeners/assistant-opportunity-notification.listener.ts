import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ASSISTANT_OPPORTUNITY_OFFERED_EVENT,
  AssistantOpportunityOfferedEvent,
} from '../../../common/events/assistant-opportunity-offered.event';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// مطابقة المساعد التلقائية (ADR-0007) — أولوية 2: عرض بث فردي لمرشّح من مجمع المساعدين،
// أول قبول صحيح ياخد الشريحة.
@Injectable()
export class AssistantOpportunityNotificationListener {
  private readonly logger = new Logger(AssistantOpportunityNotificationListener.name);

  constructor(
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ASSISTANT_OPPORTUNITY_OFFERED_EVENT)
  async handle(event: AssistantOpportunityOfferedEvent): Promise<void> {
    try {
      const candidate = await this.techniciansService.findByProfileIdOrThrow(event.assistantTechnicianId);
      await this.notificationsService.notify({
        userId: candidate.userId,
        notificationType: 'assistant_opportunity',
        titleAr: 'فرصة مساعدة جديدة',
        bodyAr: 'حد محتاج مساعد على شغلانة قريبة منك — أول واحد يقبل ياخدها.',
        referenceType: 'order_assistant_offer',
        referenceId: event.offerId,
        deepLink: `/technician/assistant-offers/${event.offerId}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار فرصة مساعدة ${event.offerId}`, err instanceof Error ? err.stack : err);
    }
  }
}
