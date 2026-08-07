export const ORDER_REASSIGNED_EVENT = 'order.reassigned';

// مختلف عمداً عن order.status_changed — ده تعيين مباشر من الأدمن (مش جزء من دورة
// matching العادية اللي بتحط الطلب على أكتر من فني مرشح قبل ما يقبل أي حد)،
// فمحتاج إشعار مختلف للفني الجديد بس، مش نفس منطق `order_technician_assigned` العام.
export class OrderReassignedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly newTechnicianProfileId: string,
  ) {}
}
