// مطابقة المساعد التلقائية (ADR-0007) — أولوية 2: عرض بث فردي اتبعت لمساعد مرشّح من المجمع،
// أول قبول صحيح ياخد الشريحة.
export const ASSISTANT_OPPORTUNITY_OFFERED_EVENT = 'assistant_matching.opportunity_offered';

export class AssistantOpportunityOfferedEvent {
  constructor(
    public readonly offerId: string,
    public readonly orderId: string,
    public readonly assistantTechnicianId: string,
  ) {}
}
