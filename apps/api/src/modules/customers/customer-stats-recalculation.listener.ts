import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ORDER_CREATED_EVENT, OrderCreatedEvent } from '../../common/events/order-created.event';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { CustomerStatsService } from './customer-stats.service';

const TERMINAL_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
];

// كانت فجوة موثّقة (referrals/README.md): customer_profiles.total_orders_count/
// completed_orders_count/... مفيش أي كود بيكتبلهم قيمة أبداً — فاضلين على القيمة الافتراضية
// للأبد، بالظبط نفس فئة الفجوة اللي كانت موجودة في technician_profiles قبل ما
// technician-stats.queue/processor يتعملوا. أخطر أثر: orders.service.ts وpromotions.service.ts
// بيستخدموا `totalOrdersCount === 0` كشرط "عميل جديد" لأكواد الخصم المقصورة على عملاء جدد —
// بما إنه مجمّد على 0، أي عميل (حتى بمئات الطلبات) كان بيتحسب "جديد" للأبد.
//
// حدثين لازمين هنا (مش واحد): ORDER_CREATED_EVENT عشان total_orders_count/first_order_at
// يتحدّثوا فور الإنشاء (مش بس عند الاكتمال — عميل عنده طلبات قيد التنفيذ لسه "له تاريخ طلبات"
// مش عميل جديد)، وORDER_STATUS_CHANGED_EVENT عشان completed/cancelled_orders_count وtotal_spent_cents
// يتحدّثوا لما الطلب يوصل لحالة نهائية.
@Injectable()
export class CustomerStatsRecalculationListener {
  private readonly logger = new Logger(CustomerStatsRecalculationListener.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly customerStatsService: CustomerStatsService,
  ) {}

  @OnEvent(ORDER_CREATED_EVENT)
  async handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
    try {
      const order = await this.orders.findOne({ where: { id: event.orderId } });
      if (!order) return; // اتلغى/اتحذف قبل ما نوصله — مش خطأ نستحق نسجّله
      await this.customerStatsService.enqueueRecalculation(order.customerId);
    } catch (err) {
      this.logger.error(`فشل جدولة إحصائيات العميل بعد إنشاء الطلب ${event.orderId}`, err instanceof Error ? err.stack : err);
    }
  }

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (!TERMINAL_STATUSES.includes(event.newStatus)) return;
    await this.customerStatsService.enqueueRecalculation(event.customerId);
  }
}
