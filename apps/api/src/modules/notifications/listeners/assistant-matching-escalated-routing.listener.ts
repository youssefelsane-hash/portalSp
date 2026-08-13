import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ASSISTANT_MATCHING_ESCALATED_EVENT,
  AssistantMatchingEscalatedEvent,
} from '../../../common/events/assistant-matching-escalated.event';
import { NotificationRoutingService } from '../notification-routing.service';

// مطابقة المساعد التلقائية (ADR-0007) — معدية مهلة البث وفيه شرائح مساعد لسه فاضية، تصعيد
// للعمليات. نفس آلية EmergencyOrderRoutingListener بالحرف (routeToRole، مش نظام موازي).
// نطاق مؤجَّل صراحة عن الـADR: حل يدوي إداري بعد التصعيد — إشعار بس دلوقتي، مش endpoint جديد.
@Injectable()
export class AssistantMatchingEscalatedRoutingListener {
  private readonly logger = new Logger(AssistantMatchingEscalatedRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(ASSISTANT_MATCHING_ESCALATED_EVENT)
  async handle(event: AssistantMatchingEscalatedEvent): Promise<void> {
    try {
      await this.routingService.routeToRole('assistant_matching.escalated', {
        notificationType: 'assistant_matching_escalated',
        titleAr: `طلب محتاج تدخل: ${event.orderNumber}`,
        bodyAr: `مطابقة المساعد التلقائي فشلت — لسه ${event.remainingSlots} مساعد ناقص على الطلب ده، محتاج تعيين يدوي.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل تصعيد مطابقة المساعد لطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
