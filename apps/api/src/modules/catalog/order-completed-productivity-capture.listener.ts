import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { ProductivityLearningService } from './productivity-learning.service';

// محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — نقطة الانطلاق: لحظة ما طلب
// حقيقي بـstandard_data_id يوصل COMPLETED (أي مسار دفع — كاش/محفظة/بطاقة، ORDER_STATUS_CHANGED_EVENT
// بيتصدّر منهم كلهم في payments.service.ts). observation تلقائي بلا أي تدخل يدوي.
@Injectable()
export class OrderCompletedProductivityCaptureListener {
  constructor(private readonly productivityLearningService: ProductivityLearningService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handle(event: OrderStatusChangedEvent): Promise<void> {
    if (event.newStatus !== OrderStatus.COMPLETED) return;
    await this.productivityLearningService.captureFromCompletedOrder(event.orderId);
  }
}
