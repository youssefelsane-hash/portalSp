import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../../common/events/order-status-changed.event';
import { OrderStatus } from '../../orders/entities/order.entity';
import { CustomerProfilesService } from '../../customers/customer-profiles.service';
import { TechniciansService } from '../../technicians/technicians.service';
import { NotificationsService } from '../notifications.service';

// عنوان/محتوى الإشعار للعميل حسب الحالة الجديدة — الحالات غير المذكورة هنا (draft, pending_payment, ...)
// مش من مخرجات transitionAsTechnician/cancel أصلاً، فمش محتاجة تتغطى هنا.
const CUSTOMER_MESSAGES: Partial<Record<OrderStatus, { title: string; body: string }>> = {
  [OrderStatus.TECHNICIAN_ON_WAY]: { title: 'الفني في الطريق', body: 'الفني بدأ يتحرّك ناحيتك دلوقتي.' },
  [OrderStatus.TECHNICIAN_ARRIVED]: { title: 'الفني وصل', body: 'الفني وصل لعنوانك.' },
  [OrderStatus.IN_PROGRESS]: { title: 'الشغل بدأ', body: 'الفني بدأ الشغل على طلبك.' },
  [OrderStatus.WORK_COMPLETED]: { title: 'الشغل خلص', body: 'الفني خلّص الشغل — راجع الفاتورة واختار طريقة الدفع.' },
};

@Injectable()
export class OrderStatusNotificationListener {
  private readonly logger = new Logger(OrderStatusNotificationListener.name);

  constructor(
    private readonly customerProfiles: CustomerProfilesService,
    private readonly techniciansService: TechniciansService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    try {
      const customerMessage = CUSTOMER_MESSAGES[event.newStatus];
      if (customerMessage) {
        const customer = await this.customerProfiles.findByProfileIdOrThrow(event.customerId);
        await this.notificationsService.notify({
          userId: customer.userId,
          notificationType: `order_${event.newStatus}`,
          titleAr: customerMessage.title,
          bodyAr: customerMessage.body,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/orders/${event.orderId}`,
        });
      }

      if (event.newStatus === OrderStatus.CANCELLED_BY_CUSTOMER && event.technicianId) {
        const technician = await this.techniciansService.findByProfileIdOrThrow(event.technicianId);
        await this.notificationsService.notify({
          userId: technician.userId,
          notificationType: 'order_cancelled_by_customer',
          titleAr: 'العميل لغى الطلب',
          bodyAr: `طلب رقم ${event.orderNumber} اتلغى من العميل.`,
          referenceType: 'order',
          referenceId: event.orderId,
          deepLink: `/technician/orders/${event.orderId}`,
        });
      }
    } catch (err) {
      this.logger.error(`فشل إشعار تغيير حالة الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }
}
