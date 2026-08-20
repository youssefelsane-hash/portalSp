import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_CREW_SHORTAGE_ESCALATED_EVENT,
  OrderCrewShortageEscalatedEvent,
} from '../../../common/events/order-crew-shortage-escalated.event';
import { NotificationRoutingService } from '../notification-routing.service';

// تصعيد نقص طاقم قبل الموعد (docs/08 §35.5) — نفس نمط EmergencyDispatchStrugglingRoutingListener/
// OrderNoTechnicianFoundRoutingListener بالحرف (routeToRole الموجود بالفعل، مفيش نظام توجيه موازي).
@Injectable()
export class OrderCrewShortageEscalatedRoutingListener {
  private readonly logger = new Logger(OrderCrewShortageEscalatedRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(ORDER_CREW_SHORTAGE_ESCALATED_EVENT)
  async handle(event: OrderCrewShortageEscalatedEvent): Promise<void> {
    try {
      const parts: string[] = [];
      if (event.missingTechnicians > 0) parts.push(`${event.missingTechnicians} فني`);
      if (event.missingAssistants > 0) parts.push(`${event.missingAssistants} مساعد`);
      const missingText = parts.join(' و');

      await this.routingService.routeToRole('order.crew_shortage_escalated', {
        notificationType: 'order_crew_shortage_escalated',
        titleAr: `طاقم ناقص قبل الموعد: ${event.orderNumber}`,
        bodyAr: `الطلب موعده ${event.scheduledAt.toLocaleString('ar-EG')} ولسه ناقصه ${missingText} — محتاج تدخّل يدوي قبل ما الموعد يوصل.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار تصعيد نقص طاقم ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
