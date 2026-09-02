import { LockedProviderLostReason } from '../../modules/orders/order-provider-lock';

export const ORDER_LOCKED_PROVIDER_LOST_EVENT = 'order.locked_provider_lost';

/**
 * ADR-0065 §2 — الفني اللي العميل أكّده بسعره ضاع (رفض/مهلة/بقى غير متاح)، والطلب وقف عند
 * `AWAITING_TECHNICIAN_RESELECTION` بدل ما يروح لحد تاني.
 *
 * حدث مستقل عن `ORDER_STATUS_CHANGED_EVENT` عمدًا: الحالة لوحدها مابتقولش **ليه** وقف، والفرق
 * ده هو كل الرسالة اللي العميل محتاج يشوفها. `TechnicianCancellationNotificationListener` بيغطي
 * نفس الحالة لكن لسبب مختلف تمامًا (فني لغى بعد ما قبل)، فدمج الاتنين كان هيبعت رسالة غلط.
 */
export class OrderLockedProviderLostEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly reason: LockedProviderLostReason,
  ) {}
}
