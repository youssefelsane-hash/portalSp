import { OrderStatus } from '../../modules/orders/entities/order.entity';

export const ORDER_STATUS_CHANGED_EVENT = 'order.status_changed';

// بيتصدر من OrdersService بعد أي انتقال حالة (فني أو إلغاء عميل) — نقطة واحدة
// يقدر أي موديول يشترك فيها (notifications, تحليلات لاحقاً, ...) من غير ما
// يعرف تفاصيل الـ state machine.
export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly previousStatus: OrderStatus,
    public readonly newStatus: OrderStatus,
    public readonly customerId: string,
    public readonly technicianId: string | null,
  ) {}
}
