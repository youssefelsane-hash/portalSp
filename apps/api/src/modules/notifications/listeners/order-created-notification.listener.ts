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
      // هجرة حجز الشغالة (ADR-0029، docs/08 §42 Phase A.4 Slice 2) — طلب بفني (شغالة) مُتفَق عليه
      // مسبقًا (زيرو مطابقة تلقائية) بيوصل هنا أصلاً ACCEPTED، مش SEARCHING_TECHNICIAN — رسالة
      // "بندوّرلك على فني" مضلّلة وغلط هنا، الفني معروف بالفعل.
      const isDomesticWorkerAssignment = order.domesticWorkerProfileId !== null;
      await this.notificationsService.notify({
        userId: customer.userId,
        notificationType: 'order_created',
        titleAr: isDomesticWorkerAssignment ? 'حجزك اتأكّد' : 'طلبك اتسجّل بنجاح',
        bodyAr: isDomesticWorkerAssignment
          ? `حجز رقم ${order.orderNumber} — الفني اللي اخترته اتأكّد على الموعد ده.`
          : `طلب رقم ${order.orderNumber} — بندوّرلك على أقرب فني متاح دلوقتي.`,
        referenceType: 'order',
        referenceId: order.id,
        deepLink: `/orders/${order.id}`,
      });
    } catch (err) {
      this.logger.error(`فشل إشعار إنشاء الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
