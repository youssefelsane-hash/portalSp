import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_STATUS_CHANGED_EVENT, OrderStatusChangedEvent } from '../../common/events/order-status-changed.event';
import { OrderStatus } from '../orders/entities/order.entity';
import { TechnicianScheduleService } from './technician-schedule.service';

const CANCELLED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_TECHNICIAN,
  OrderStatus.CANCELLED_BY_SYSTEM,
];

// الجدولة الحقيقية للفني (docs/08 §2-§3) — لو طلب محجوز على سلوت وقت معيّن اتلغى بأي طريقة
// (عميل/فني/إداري/تلقائي)، السلوت لازم يرجع "متاح" فورًا بدل ما يفضل "محجوز" أبديًا لطلب ملغي —
// وإلا الفني بيفقد الوقت ده للأبد من غير أي طلب حقيقي شغال عليه. نفس نمط
// TechnicianStatsRecalculationListener بالحرف (استماع مركزي لـORDER_STATUS_CHANGED_EVENT بدل
// ما نضيف نداء يدوي في كل مكان بيلغي طلب — 4 أماكن مختلفة: cancel/technicianCancel/admin/auto-cancel).
// releaseSlotForOrder() نفسها idempotent (UPDATE ... WHERE order_id=X بس) — استدعاؤها لطلب
// مالوش سلوت أصلاً (الحالة الشائعة) no-op آمن تمامًا، صفر أثر جانبي.
@Injectable()
export class ScheduleSlotReleaseListener {
  constructor(private readonly scheduleService: TechnicianScheduleService) {}

  @OnEvent(ORDER_STATUS_CHANGED_EVENT)
  async handleOrderStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (!CANCELLED_STATUSES.includes(event.newStatus)) return;
    await this.scheduleService.releaseSlotForOrder(event.orderId);
  }
}
