// مطابقة المساعد التلقائية (ADR-0007) — job بيتنفّذ لما مهلة رد المساعدين على عرض بث تنتهي
// (assistant_matching.response_timeout_seconds) من غير ما العدد المطلوب يكتمل. نفس فلسفة
// matching-rounds.queue.ts بالحرف.
export const ASSISTANT_MATCHING_QUEUE = 'assistant-matching';
export const ASSISTANT_OFFERS_EXPIRED_JOB = 'assistant-offers-expired';

export interface AssistantOffersExpiredJobData {
  orderId: string;
}

// BullMQ بيرفض أي jobId فيه ":" — نفس سبب roundExpiredJobId في matching-rounds.queue.ts
export function assistantOffersExpiredJobId(orderId: string): string {
  return `assistant-offers-${orderId}`;
}
