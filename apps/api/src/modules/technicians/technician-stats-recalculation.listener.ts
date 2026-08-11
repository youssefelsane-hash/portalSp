import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { TechnicianStatsService } from './technician-stats.service';

const CANCELLED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
];

// كانت فجوة موثّقة: technician_profiles.cancelled_orders_count مفيش أي كود بيكتبله قيمة أبداً —
// حتى TechnicianStatsProcessor نفسه (اللي بيحدّث completed_orders_count/average_rating فعليًا)
// كان بيتجاهله. الأثر: public-technician-profile-response.dto.ts بيحسب cancellation_rate من
// completedOrdersCount/cancelledOrdersCount ويعرضه للعميل — بما إن العمود مجمّد على 0، كل فني
// كان بيظهر بمعدل إلغاء 0% كاذب. enqueueRecalculation() للفني كان بيتنادى بس عند الاكتمال
// (payments) أو التقييم (ratings) — مفيش نقطة استدعاء عند الإلغاء خالص، فده listener جديد
// يسدّ الفجوة دي تحديدًا (نفس نمط customers/customer-stats-recalculation.listener.ts).
@Injectable()
export class TechnicianStatsRecalculationListener {
  constructor(private readonly technicianStatsService: TechnicianStatsService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (!event.technicianId || !CANCELLED_STATUSES.includes(event.newStatus)) return;
    await this.technicianStatsService.enqueueRecalculation(event.technicianId);
  }
}
