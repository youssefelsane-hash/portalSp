// اسم الطابور وشكل الوظيفة اللي بتتنفّذ لما مهلة رد الفني على جولة توزيع تنتهي (30 ثانية،
// RESPONSE_TIMEOUT_SECONDS في matching.service.ts) من غير أي رد صريح (قبول/رفض) — سيناريو
// واقعي جداً (الموبايل مقفول، التطبيق مقفول) كان قبل كده بيعلّق الطلب للأبد لأن مفيش أي
// آلية كانت بتتحرك غير الرفض الصريح.
export const MATCHING_ROUNDS_QUEUE = 'matching-rounds';
export const ROUND_EXPIRED_JOB = 'round-expired';

export interface RoundExpiredJobData {
  orderId: string;
  round: number;
}

// BullMQ بيرفض أي jobId فيه ":" (محجوز داخلياً لمفاتيح Redis بتاعته) — استخدمنا "-" بدلاً منها
export function roundExpiredJobId(orderId: string, round: number): string {
  return `${orderId}-r${round}`;
}
