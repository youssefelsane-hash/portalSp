import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../../common/events/order-created.event';
import { BookingMode, Order } from '../../orders/entities/order.entity';
import { NotificationRoutingService } from '../notification-routing.service';

// هيكل الحجز الجديد (docs/06 §1.7/§2.2، docs/07 الجزء ج) — "الموظف نفسه أو الأدمن يستلم إشعار
// إن في حد طلب حاجة طوارئ، بحيث يقدر يمسك تليفون ويرد على الصنايعي". بيستخدم NotificationRoutingService
// الموجود بالفعل (routeToRole) بدل ما يبني نظام موازي — نفس آلية complaint.filed/payout.completed.
// event_type ('order.emergency_created') مختلف عمداً عن ORDER_CREATED_EVENT الحقيقي (اللي كل
// الطلبات بتصدّره) عشان قاعدة التوجيه في /admin/notification-routing-rules تفضل خاصة بالطوارئ بس.
@Injectable()
export class EmergencyOrderRoutingListener {
  private readonly logger = new Logger(EmergencyOrderRoutingListener.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: event.orderId } });
      if (!order || order.bookingMode !== BookingMode.EMERGENCY) return;

      await this.routingService.routeToRole('order.emergency_created', {
        notificationType: 'order_emergency_created',
        titleAr: `طلب طوارئ جديد: ${order.orderNumber}`,
        bodyAr: 'عميل طلب خدمة طوارئ — بندوّر على أقرب فني، تابع الطلب لو محتاج تتدخل يدوياً.',
        referenceType: 'order',
        referenceId: order.id,
        deepLink: `/admin/orders/${order.id}`,
      });
    } catch (err) {
      this.logger.error(`فشل توجيه إشعار طلب الطوارئ ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
