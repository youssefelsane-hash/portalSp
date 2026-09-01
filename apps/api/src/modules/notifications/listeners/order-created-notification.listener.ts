import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../../common/events/order-created.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { Order } from '../../orders/entities/order.entity';
import { NotificationsService } from '../notifications.service';
import { NotificationRoutingService } from '../notification-routing.service';

@Injectable()
export class OrderCreatedNotificationListener {
  private readonly logger = new Logger(OrderCreatedNotificationListener.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
    private readonly routingService: NotificationRoutingService,
  ) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: event.orderId } });
      if (!order) return; // اتلغى/اتحذف قبل ما نوصله — مش خطأ نستحق نسجّله

      const customer = await this.customerProfiles.findByProfileIdOrThrow(order.customerId);
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'order_created',
        titleAr: 'طلبك اتسجّل بنجاح',
        bodyAr:
          order.orderStatus === 'awaiting_admin_quote'
            ? `طلب رقم ${order.orderNumber} — الإدارة بتراجع الصور وهتبعتلك السعر قبل اختيار الفني.`
            : `طلب رقم ${order.orderNumber} — بندوّرلك على أقرب فني متاح دلوقتي.`,
        referenceType: 'order',
        referenceId: order.id,
        deepLink: `/orders/${order.id}`,
      });

      if (order.orderStatus === 'awaiting_admin_quote') {
        await this.routingService.routeToRole('order.photo_quote_requested', {
          notificationType: 'order_photo_quote_requested',
          titleAr: `طلب تسعير بالصور: ${order.orderNumber}`,
          bodyAr: 'العميل رفع صور المشكلة ومستني الإدارة تحدد السعر قبل اختيار الفني.',
          referenceType: 'order',
          referenceId: order.id,
          deepLink: `/admin/orders/${order.id}`,
        });
      }
    } catch (err) {
      this.logger.error(`فشل إشعار إنشاء الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
