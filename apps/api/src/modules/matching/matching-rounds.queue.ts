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

/**
 * **توزيع طلب جديد** — الشغل اللي كان بيتنفّذ داخل نفس عملية طلب الـHTTP بتاع `POST /orders`.
 *
 * ### ليه بقى وظيفة طابور
 *
 * `create()` بتاخد اتصال قاعدة بيانات للترانزاكشن بتاعتها، وبعد ما تنجح كان `OrderDispatchListener`
 * بينادي `dispatchOrAutoConfirm()` **في نفس العملية فورًا** — وده بياخد اتصال **تاني** (بحث
 * مرشّحين + قفل + تأكيد). يعني كل حجز واحد بيطلب لحد اتصالين، **وبلا أي سقف على عدد اللي شغال
 * في نفس الوقت**.
 *
 * القياس الحي (`scripts/concurrency-booking-safety.js`) على pool = ٢٠:
 *
 * | متزامنين | زمن الدفعة | نتيجة |
 * |---|---|---|
 * | ١ | ٢٤٠ms | كله ٢٠١ |
 * | ١٠ | ٦٨٩ms | كله ٢٠١ |
 * | ٢٠ | ١١٧٢ms | كله ٢٠١ |
 * | ٤٠ | **١١١١١ms** | **٢٣ عميل اترفضوا بـ503** |
 *
 * الانهيار عند تخطّي سقف الـpool مش تدهور تدريجي — ده **انهيار تشبّع**: طلبات الـHTTP ماسكة كل
 * الاتصالات، وشغل التوزيع الخلفي مستني اتصالات مش هتفضى، فالطلبات بتتخطّى مهلة الحصول على
 * اتصال (١٠ ثواني) وبترجع 503 لعميل حقيقي.
 *
 * الطابور بيحوّل ده لـ**ضغط خلفي (backpressure)** بدل رفض: الـworker بياخد عدد محدود من وظايف
 * التوزيع في نفس الوقت، والباقي بيستنى في Redis. دفعة ألف حجز بتترصّ وتتصرّف بالراحة — بطيئة،
 * بس **صفر رفض وصفر طلب ضايع**. ده بالظبط قرار المالك: «حتى لو الطلب هياخد شوية… المهم ما يقعش».
 */
export const ORDER_DISPATCH_JOB = 'order-dispatch';

export interface OrderDispatchJobData {
  orderId: string;
}

/**
 * مفتاح ثابت لكل طلب — نفس فلسفة `roundExpiredJobId`: لو الحدث اتبعت مرتين (إعادة محاولة،
 * نسختين شغّالين) BullMQ بيرفض التكرار بدل ما يوزّع نفس الطلب مرتين.
 */
export function orderDispatchJobId(orderId: string): string {
  return `dispatch-${orderId}`;
}
