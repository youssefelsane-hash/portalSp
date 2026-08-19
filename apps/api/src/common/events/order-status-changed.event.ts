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
    public readonly reason: string | null = null,
    // بَقّة حقيقية حية اتلقطت (Script 6 Part 11/12/14): CANCELLED_BY_SYSTEM بيتصدر لحالتين مختلفتين
    // تمامًا — إلغاء أدمن فعلي (admin-orders.service.ts، cancelledByUserId مضبوط) وإلغاء تلقائي
    // حقيقي بلا أي تدخل بشري (matching.service.ts، مفيش فنيين متاحين، cancelledByUserId=null).
    // OrderStatusNotificationListener كان بيفترض CANCELLED_BY_SYSTEM = أدمن دايمًا، فالعميل كان
    // بياخد إشعار "طلبك اتلغى من الإدارة" حتى لو محدش من الإدارة لمس الطلب خالص. الحقل ده هو
    // المُميّز الحقيقي بدل الافتراض.
    public readonly cancelledByUserId: string | null = null,
  ) {}
}
