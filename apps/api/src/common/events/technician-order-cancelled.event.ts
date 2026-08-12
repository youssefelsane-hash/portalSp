import { BookingMode } from '../../modules/orders/entities/order.entity';
import { CancellationRecoveryAction } from '../../modules/orders/entities/technician-order-cancellation.entity';

export const TECHNICIAN_ORDER_CANCELLED_EVENT = 'order.technician_cancelled';

// حدث مخصوص (مش ORDER_STATUS_CHANGED_EVENT العام) لأن newStatus بعد إلغاء الفني بقى
// searching_technician أو awaiting_technician_reselection — نفس الحالة اللي طلبات تانية
// كتير بتبقى فيها لأسباب عادية، فمفيش طريقة موثوقة نميّز "ده كان إلغاء فني" من الحدث العام
// من غير حدث مخصوص. notifications module بيشترك فيه للإشعار عالي الأولوية للعميل + توجيه الأدمن.
export class TechnicianOrderCancelledEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerProfileId: string,
    public readonly cancelledByTechnicianId: string,
    public readonly customerSafeReasonAr: string,
    public readonly recoveryAction: CancellationRecoveryAction,
    public readonly bookingMode: BookingMode,
  ) {}
}
