// مطابقة المساعد التلقائية (ADR-0007) — أولوية 1: المساعد الشخصي المعتمد للفني القائد اتعيّن
// مباشرة (بلا بث تنافسي، لأنه أهل واحد بس).
export const ASSISTANT_PERSONAL_ASSIGNED_EVENT = 'assistant_matching.personal_assigned';

export class AssistantPersonalAssignedEvent {
  constructor(
    public readonly orderId: string,
    public readonly assistantTechnicianId: string,
  ) {}
}
