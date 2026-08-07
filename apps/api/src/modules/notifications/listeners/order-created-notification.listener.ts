import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../../common/events/order-created.event';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { Order } from '../../orders/entities/order.entity';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderCreatedNotificationListener {
  private readonly logger = new Logger(OrderCreatedNotificationListener.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerProfiles: CustomerProfilesService,
    private readonly notificationsService: NotificationsService,
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
        bodyAr: `طلب رقم ${order.orderNumber} — بندوّرلك على أقرب فني متاح دلوقتي.`,
        referenceType: 'order',
        referenceId: order.id,
        deepLink: `/orders/${order.id}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار إنشاء الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
