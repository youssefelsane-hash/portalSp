// تصعيد دفعات الطوارئ (docs/08 §17.15) — بيتصدّر مرة واحدة بس لكل طلب طوارئ (لما `nextRound`
// يوصل لعتبة `matching.emergency_escalation_after_rounds` القابلة للتعديل) عشان ينبّه الأدمن/
// الموظف إن الطلب لسه بيدوّر على فني من غير نجاح، قبل ما يوصل لسقف الجولات/الفنيين ويتلغي تلقائي.
export const ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT = 'matching.order_emergency_dispatch_struggling';

export class OrderEmergencyDispatchStrugglingEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly roundsSoFar: number,
    public readonly techniciansContactedSoFar: number,
  ) {}
}
