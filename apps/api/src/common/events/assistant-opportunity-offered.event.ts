// مطابقة المساعد التلقائية (ADR-0007) — أولوية 2: عرض بث فردي اتبعت لمساعد مرشّح من المجمع،
// أول قبول صحيح ياخد الشريحة.
export const ASSISTANT_OPPORTUNITY_OFFERED_EVENT = 'assistant_matching.opportunity_offered';

export class AssistantOpportunityOfferedEvent {
  constructor(
    public readonly offerId: string,
    public readonly orderId: string,
    public readonly assistantTechnicianId: string,
    // رقم الطلب الإنساني (docs/08 §92) — الرسالة كانت بلا أي هوية للطلب، فلو نفس الفني كان
    // مؤهّل لأكتر من طلب محتاج مساعدة في نفس الوقت، كل الإشعارات كانت بتبان متطابقة تمامًا
    // (نفس العنوان، نفس النص) — الفني ما كانش يقدر يميّز إشعار عن التاني، وكان بيبان كأنه نفس
    // الإشعار متكرر مش فرص حقيقية مختلفة.
    public readonly orderNumber: string,
  ) {}
}
