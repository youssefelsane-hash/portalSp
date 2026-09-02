// مطابقة المساعد التلقائية (ADR-0007) — job بيتنفّذ لما مهلة رد المساعدين على عرض بث تنتهي
// (assistant_matching.response_timeout_seconds) من غير ما العدد المطلوب يكتمل. نفس فلسفة
// matching-rounds.queue.ts بالحرف.
export const ASSISTANT_MATCHING_QUEUE = 'assistant-matching';
export const ASSISTANT_OFFERS_EXPIRED_JOB = 'assistant-offers-expired';

export interface AssistantOffersExpiredJobData {
  orderId: string;
}

/**
 * BullMQ بيرفض أي jobId فيه ":" — نفس سبب roundExpiredJobId في matching-rounds.queue.ts.
 *
 * **الجولة جزء من المعرّف** (ADR-0061 §4): BullMQ بيتجاهل `add()` لمعرّف موجود بالفعل (حتى لو
 * الـjob خلص وقاعد في مجموعة completed)، فمعرّف واحد لكل الجولات كان معناه إن مؤقّت الجولة
 * التانية **مايشتغلش خالص** — والطلب يفضل معلّق للأبد بدل ما يتصعّد. ده كان هيبقى أسوأ من
 * التصعيد الفوري اللي بنستبدله.
 */
export function assistantOffersExpiredJobId(orderId: string, round: number): string {
  return `assistant-offers-${orderId}-r${round}`;
}
