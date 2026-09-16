/**
 * **مؤشر الوصول: مفهومين مختلفين حسب أفق الطلب** (طلب مالك 2026-09-16، docs/08 §153، ADR-0099).
 *
 * > «عندنا العميل ممكن يحجز خدمة بعد يوم أو بعد أسبوع، فـETA بمعنى "الفني هيوصل بعد كام دقيقة
 * >  دلوقتي" مش دايمًا له قيمة… لو الطلب مجدول بعد فترة، المسافة تفضل عامل في الاختيار
 * >  والكفاءة، لكن بدل ETA لحظي ممكن نستخدم حاجة أذكى زي: متوسط التزام الفني بالمواعيد، نسبة
 * >  التأخير السابقة، متوسط مدة الوصول لنفس المنطقة.»
 *
 * ### المشكلة اللي القرار ده بيقفلها
 *
 * الكارت كان بيعرض «وصول متوقع ~N د» لأي طلب، والرقم ده أصلاً **مش تنبؤ**: هو متوسط تاريخي
 * لمدة انتقال الفني (`technician_departed_at` → `technician_arrived_at`) على **كل** تاريخه
 * وفي **كل** المناطق. يعني:
 *  - مالوش أي علاقة بالمسافة المعروضة جنبه (ظهر «~0 د» جنب «2713.7 كم» في لقطة المالك).
 *  - ومالوش معنى أصلاً لطلب بعد أسبوع — محدش بيسأل «هيوصل بعد كام دقيقة» عن شغل الأسبوع الجاي.
 *
 * ### القاعدة
 *
 * | أفق الطلب | المؤشر المعروض | ليه |
 * |---|---|---|
 * | فوري / قريب جدًا | **مدة الوصول المتوقعة** (+ المسافة) | العميل مستني حد **دلوقتي**، فالدقايق دي هي القيمة |
 * | مجدول بعد فترة | **الالتزام بالمواعيد** (+ المسافة) | السؤال بقى «هيلحق معاده؟» مش «هيوصل امتى» |
 *
 * **المسافة بتفضل معروضة ومؤثّرة في الحالتين** — هي عامل كفاءة وتكلفة انتقال (ADR-0062)، مش
 * مجرد مدخل لحساب ETA. اللي بيتغيّر هو المؤشر الزمني اللي جنبها.
 *
 * ### ليه القرار في السيرفر مش في الواجهة
 *
 * نفس قاعدة `resolveDispatchRoute()` و`booking-window`: القاعدة اللي بتتقري في التطبيق والويب
 * والأدمن لازم تتحسب مرة واحدة. لو كل واجهة اشتقت «ده طلب قريب ولا بعيد» بنفسها، أول اختلاف
 * بيخلّي شاشتين يعرضوا مؤشرين مختلفين لنفس الطلب.
 */

/** أي حاجة عندها `getNumber` — نفس فلسفة `resolveDailyCapacityMinutes` (بلا اعتماد على SettingsService). */
interface NumberSettingReader {
  getNumber(key: string, fallback: number): Promise<number>;
}

/**
 * العتبة الافتراضية بالساعات. **نفس رقم `matching.near_term_request_hours`** المستخدم في
 * التوزيع ووزن المسافة — مقصود إنه نفس المفتاح مش رقم تاني: «الطلب القريب» لازم يبقى نفس
 * التعريف في كل مكان، وإلا الأدمن يغيّر العتبة ويلاقي المؤشر بيقول حاجة والتوزيع بيعمل حاجة تانية.
 */
export const NEAR_TERM_ARRIVAL_HOURS_FALLBACK = 48;

/** أقل عدد زيارات قبل ما نعرض نسبة التزام — نسبة مبنية على زيارة أو اتنين بتكذب. */
export const MIN_PUNCTUALITY_SAMPLE_FALLBACK = 3;

export type ArrivalMetricMode = 'expected_arrival' | 'punctuality';

export interface ArrivalMetricDecision {
  mode: ArrivalMetricMode;
  /** العتبة السارية وقت القرار — عشان الأدمن يربط اللي شافه بالإعداد. */
  nearTermHours: number;
}

/**
 * الطلب ده «قريب» بحيث إن مدة الوصول ليها معنى؟
 *
 * طلب بلا موعد (ASAP/طوارئ) **قريب بالتعريف** — هو أقرب ما يكون. نفس قاعدة
 * `resolveDistanceWeight()` بالحرف.
 */
export function resolveArrivalMetricMode(
  scheduledAt: Date | string | null | undefined,
  nearTermHours: number,
  now: Date = new Date(),
): ArrivalMetricMode {
  if (nearTermHours <= 0) return 'punctuality';
  if (!scheduledAt) return 'expected_arrival';
  const at = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (Number.isNaN(at.getTime())) return 'punctuality';
  return at.getTime() - now.getTime() <= nearTermHours * 3_600_000 ? 'expected_arrival' : 'punctuality';
}

export async function resolveArrivalMetric(
  settings: NumberSettingReader,
  scheduledAt: Date | string | null | undefined,
  now: Date = new Date(),
): Promise<ArrivalMetricDecision> {
  const nearTermHours = await settings.getNumber(
    'matching.near_term_request_hours',
    NEAR_TERM_ARRIVAL_HOURS_FALLBACK,
  );
  return { mode: resolveArrivalMetricMode(scheduledAt, nearTermHours, now), nearTermHours };
}

/**
 * **قياس الالتزام بالمواعيد** — الأرقام الخام زي ما القاعدة رجّعتها، بلا أي تجميل.
 *
 * `sampleCount` جزء أصيل من العقد مش تفصيلة: نسبة ١٠٠٪ مبنية على زيارة واحدة مالهاش نفس معنى
 * ١٠٠٪ على خمسين، والواجهة لازم تقدر تفرّق.
 */
export interface PunctualityStats {
  /** نسبة الوصول في الميعاد (± سماحية) من إجمالي الزيارات اللي ليها موعد ووصول مسجّل. */
  onTimeRatePercent: number | null;
  /** متوسط التأخير بالدقايق **على الزيارات المتأخرة وحدها** — «متوسط تأخيره كام» بنص المالك. */
  averageLateMinutes: number | null;
  /** عدد الزيارات اللي النسبة اتحسبت منها. */
  sampleCount: number;
}

/**
 * هل الرقم ده يستاهل يتعرض للعميل؟
 *
 * نسبة مبنية على عيّنة صغيرة بتدّي انطباع غلط في الاتجاهين: فني جديد وصل مرة متأخر بيبان
 * «٠٪ التزام»، وفني وصل مرة في معاده بيبان «١٠٠٪». الإخفاء أصدق من رقم مضلّل.
 */
export function isPunctualityDisplayable(stats: PunctualityStats, minSample: number): boolean {
  return stats.onTimeRatePercent !== null && stats.sampleCount >= Math.max(1, minSample);
}

/**
 * **مدة الوصول المتوقعة** — بتتعرض لو وبس لو كانت رقم حقيقي.
 *
 * صفر دقيقة **مش قيمة صالحة**: هو ناتج بيانات ناقصة (`departed_at = arrived_at`)، وعرضه
 * كـ«وصول متوقع ~0 د» بيخلّي الكارت يكذب — وده بالظبط اللي ظهر في لقطة المالك.
 */
export function isExpectedArrivalDisplayable(minutes: number | null): boolean {
  return minutes !== null && minutes > 0;
}
