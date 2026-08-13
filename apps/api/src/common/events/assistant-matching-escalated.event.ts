// مطابقة المساعد التلقائية (ADR-0007) — معدية مهلة البث وفيه شرائح مساعد لسه فاضية، محتاج
// تدخل يدوي من العمليات/الأدمن.
export const ASSISTANT_MATCHING_ESCALATED_EVENT = 'assistant_matching.escalated';

export class AssistantMatchingEscalatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly remainingSlots: number,
  ) {}
}
