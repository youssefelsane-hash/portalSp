import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT,
  OrderEmergencyDispatchStrugglingEvent,
} from '../../../common/events/order-emergency-dispatch-struggling.event';
import { NotificationRoutingService } from '../notification-routing.service';

// تصعيد دفعات الطوارئ (docs/08 §17.15) — نفس نمط EmergencyOrderRoutingListener بالحرف
// (routeToRole الموجود بالفعل، مفيش نظام توجيه موازي). event_type مختلف عمداً عن
// 'order.emergency_created' عشان الأدمن يقدر يوجّه قاعدة منفصلة (مثلاً لفريق تصعيد مختلف).
@Injectable()
export class EmergencyDispatchStrugglingRoutingListener {
  private readonly logger = new Logger(EmergencyDispatchStrugglingRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT)
  async handle(event: OrderEmergencyDispatchStrugglingEvent): Promise<void> {
    try {
      await this.routingService.routeToRole('order.emergency_dispatch_struggling', {
        notificationType: 'order_emergency_dispatch_struggling',
        titleAr: `طلب طوارئ محتاج متابعة: ${event.orderNumber}`,
        bodyAr: `لسه بندوّر على فني بعد ${event.roundsSoFar} جولة توزيع (${event.techniciansContactedSoFar} فني اتواصلنا معاهم) — ممكن تحتاج تتدخل يدوياً.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار تصعيد طوارئ ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
