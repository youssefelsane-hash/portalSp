import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  RECURRING_TEMPLATE_GENERATION_FAILING_EVENT,
  RecurringTemplateGenerationFailingEvent,
} from '../../../common/events/recurring-template-generation-failing.event';
import { NotificationRoutingService } from '../notification-routing.service';

// موثوقية توليد الطلبات المتكررة (docs/08 §19 بند 20) — نفس نمط
// EmergencyDispatchStrugglingRoutingListener بالحرف (routeToRole الموجود بالفعل).
@Injectable()
export class RecurringTemplateGenerationFailingRoutingListener {
  private readonly logger = new Logger(RecurringTemplateGenerationFailingRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(RECURRING_TEMPLATE_GENERATION_FAILING_EVENT)
  async handle(event: RecurringTemplateGenerationFailingEvent): Promise<void> {
    try {
      await this.routingService.routeToRole('recurring_template.generation_failing', {
        notificationType: 'recurring_template_generation_failing',
        titleAr: `قالب متكرر بيفشل في التوليد`,
        bodyAr: `قالب الطلب المتكرر ${event.templateId} فشل ${event.attempts} مرات متتالية وتخطّى الموعد ده — السبب: ${event.reason}`,
        referenceType: 'recurring_order_template',
        referenceId: event.templateId,
        // مفيش شاشة تفاصيل مخصّصة لقالب واحد في apps/admin دلوقتي (apps/admin/src/app/recurring-orders/page.tsx
        // شاشة list بس) — بيوجّه لنفس الـlist زي غيره من deepLinks لحد ما تُبنى شاشة تفاصيل.
        deepLink: `/admin/recurring-orders`,
      });
    } catch (err) {
      this.logger.error(
        `فشل توجيه إشعار فشل توليد قالب متكرر ${event.templateId}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
