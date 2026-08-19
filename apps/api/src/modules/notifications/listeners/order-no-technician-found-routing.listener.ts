import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_NO_TECHNICIAN_FOUND_EVENT, OrderNoTechnicianFoundEvent } from '../../../common/events/order-no-technician-found.event';
import { NotificationRoutingService } from '../notification-routing.service';

// نفس نمط EmergencyDispatchStrugglingRoutingListener بالحرف — قرار المالك 2026-08-19: مفيش إلغاء
// تلقائي لطلب مفيش فني اتلاقاله، الأدمن/الموظف (call center) هما اللي يتصرفوا يدويًا.
@Injectable()
export class OrderNoTechnicianFoundRoutingListener {
  private readonly logger = new Logger(OrderNoTechnicianFoundRoutingListener.name);

  constructor(private readonly routingService: NotificationRoutingService) {}

  @OnEvent(ORDER_NO_TECHNICIAN_FOUND_EVENT)
  async handle(event: OrderNoTechnicianFoundEvent): Promise<void> {
    try {
      await this.routingService.routeToRole('order.no_technician_found', {
        notificationType: 'order_no_technician_found',
        titleAr: `طلب محتاج فني: ${event.orderNumber}`,
        bodyAr: `مفيش فني مؤهّل متاح دلوقتي للطلب ده — لسه جاري البحث تلقائيًا، ممكن تحتاج تتصل بفنيين يفعّلوا الإتاحية أو تعيّن فني إجباريًا.`,
        referenceType: 'order',
        referenceId: event.orderId,
        deepLink: `/admin/orders/${event.orderId}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار "مفيش فني" ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
