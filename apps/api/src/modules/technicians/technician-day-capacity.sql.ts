/**
 * القدرة الاستيعابية اليومية بالدقايق (ADR-0059) — **المصدر الوحيد** لسؤال «الشخص ده عنده
 * متسع للشغل ده؟».
 *
 * بيحل محل قاعدة ADR-0018 §2 القديمة (بوليان «شاغل يوم كامل» على يوم البداية بس)، اللي كان فيها
 * غلطتين مستقلتين وثّقهم ADR-0059:
 *
 * 1. **الالتزام كان بيتسجّل على يوم البداية بس.** شغل 5 أيام كان بيقفل يوم 1 وبس؛ أيام 2-5
 *    الشخص فيهم «فاضي» في نظر كل الاستعلامات. ونفس البَقّة كانت بتضرب حجز الشهر (ADR-0050 §4).
 * 2. **القاعدة كانت غير متماثلة.** كانت بتسأل «هل الطلب **القديم** شاغل يوم كامل؟» وبتقيس
 *    الطلب الجديد بمعيار تاني، فالإجابة بتتغيّر حسب مين بيسأل — بالظبط بلاغ المالك: «أ» ظاهر
 *    لـ«ب» و«ب» مش ظاهر لـ«أ» رغم إنهم في نفس اليوم.
 *
 * النموذج الجديد بيقيس الطرفين بنفس المسطرة (دقايق على يوم)، فالتماثل **خاصية بنيوية** مش
 * إصلاح في موضع.
 */

/** القدرة اليومية الافتراضية — 12 ساعة (طلب مالك صريح). قابلة للتعديل: `matching.daily_capacity_minutes`. */
export const DAILY_CAPACITY_MINUTES_FALLBACK = 720;

/** مدة افتراضية لشغلانة مالهاش أي تقدير — ساعة. نفس الافتراض المستخدم في باقي المشروع. */
export const DEFAULT_JOB_MINUTES = 60;

/**
 * كل الطلبات اللي الشخص ملتزم بيها فعليًا — قائد (`orders.technician_id`) **أو** عضو طاقم
 * (`order_team_members.technician_id`).
 *
 * ADR-0057: المساعد بطبيعته دايمًا عضو طاقم مش قائد، فقراءة `orders.technician_id` لوحدها كانت
 * بتخليه **شفاف تمامًا** لكل فحوص التعارض. ADR-0059 بيحافظ على نفس التوحيد: الصنايعي والمساعد
 * نفس الشيء في الجدولة، الفرق الوحيد في التسعير.
 */
function committedOrdersSource(technicianIdExpr: string, alias: string): string {
  return `(
        SELECT ${alias}.* FROM orders ${alias} WHERE ${alias}.technician_id = ${technicianIdExpr}
        UNION
        SELECT ${alias}.* FROM orders ${alias}
        JOIN order_team_members ${alias}_otm ON ${alias}_otm.order_id = ${alias}.id
        WHERE ${alias}_otm.technician_id = ${technicianIdExpr}
      ) ${alias}`;
}

/**
 * عدد الأيام اللي الطلب بيمتد عليها — **ناتج محرك التسعير** (`estimated_duration_days`،
 * ADR-0050)، بحد أدنى يوم واحد. ده بالظبط اللي المالك أشار له: «عدد الأيام اللي الـprice engine
 * بيحددها».
 */
function spanDaysExpr(alias: string): string {
  return `GREATEST(COALESCE(CEIL(${alias}.estimated_duration_days)::int, 1), 1)`;
}

/**
 * الدقايق اللي الطلب بياخدها **من كل يوم** في مداه.
 *
 * **الشغل المقدَّر بالأيام بياخد اليوم بالكامل** — مش `الإجمالي ÷ الأيام`، ومش دقايقه الخام.
 * `estimated_duration_days` **موجودة صراحةً** معناها محرك التسعير قال «الشغلانة دي بتاخد N
 * يوم»، وده بالتعريف يوم كامل في كل يوم من الـN (اللي عنده تركيب 3 أيام مش فاضي 8 ساعات كل
 * يوم؛ هو في الموقع اليوم كله). ده اللي بيخلي «محجوز شهر كامل» تعني اللي المالك قصده، وهو كمان
 * اللي بيحافظ على سلوك ADR-0018 §2 لطلب `estimated_duration_days = 1`.
 *
 * **الحساب بالدقايق بيسري بس على الشغل اللي مالوش تقدير بالأيام** — الشغلانات القصيرة اللي
 * بتتقاس بالساعة، واللي السقف اليومي (12 ساعة) اتعمل عشانها أصلاً.
 */
function perDayMinutesExpr(alias: string, serviceAlias: string, capacityParam: string): string {
  return `CASE
      WHEN ${alias}.estimated_duration_days IS NOT NULL AND ${alias}.estimated_duration_days >= 1
        THEN ${capacityParam}::int
      ELSE LEAST(
        COALESCE(
          ${alias}.duration_minutes,
          ${alias}.duration_hours * 60,
          ${serviceAlias}.estimated_duration_minutes,
          ${DEFAULT_JOB_MINUTES}
        ),
        ${capacityParam}::int
      )
    END`;
}

/**
 * يوم بداية الطلب بتوقيت القاهرة. طلب بلا `scheduled_at` (ASAP/طوارئ) بيترسّى على يوم إنشائه —
 * نفس فلسفة `COALESCE(scheduled_at, now())` القديمة، بس مربوطة بالطلب نفسه مش بلحظة الاستعلام
 * عشان النتيجة تفضل ثابتة.
 */
function startDayExpr(alias: string): string {
  return `(COALESCE(${alias}.scheduled_at, ${alias}.created_at) AT TIME ZONE 'Africa/Cairo')::date`;
}

export interface DayLoadOpts {
  /** تعبير SQL لمعرّف الفني، مثلاً `tp.id` أو `$1`. */
  technicianIdExpr: string;
  /** parameter لقائمة الحالات النشطة (`ACTIVE_TECHNICIAN_ORDER_STATUSES`). */
  activeStatusesParam: string;
  /** parameter لمعرّف الطلب المرشّح نفسه — بيتستبعد من الحساب عشان مايتحسبش على نفسه. */
  excludeOrderIdParam: string;
  /** parameter للقدرة اليومية بالدقايق (`matching.daily_capacity_minutes`). */
  dailyCapacityParam: string;
}

/**
 * استعلام فرعي بيرجّع صف لكل **يوم مشغول** للشخص: `(busy_day, busy_minutes)`.
 *
 * كل طلب بيتفرد على أيامه بـ`generate_series` — ده الجزء اللي بيقفل بَقّة «الشغل الممتد بيقفل
 * يوم البداية بس».
 */
export function technicianDayLoadSubquery(opts: DayLoadOpts): string {
  const { technicianIdExpr, activeStatusesParam, excludeOrderIdParam, dailyCapacityParam } = opts;
  return `(
    SELECT gs.busy_day::date AS busy_day,
           SUM(${perDayMinutesExpr('lo', 'ls', dailyCapacityParam)})::int AS busy_minutes
    FROM ${committedOrdersSource(technicianIdExpr, 'lo')}
    JOIN services ls ON ls.id = lo.service_id
    CROSS JOIN LATERAL generate_series(
      ${startDayExpr('lo')}::timestamp,
      (${startDayExpr('lo')} + (${spanDaysExpr('lo')} - 1))::timestamp,
      interval '1 day'
    ) AS gs(busy_day)
    WHERE lo.deleted_at IS NULL
      AND lo.order_status = ANY(${activeStatusesParam}::order_status[])
      AND lo.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
    GROUP BY gs.busy_day
  )`;
}

/**
 * **الحمل التشغيلي للطلب المرشّح — بنفس قاعدة الطلب القائم بالظبط** (ADR-0061 §2).
 *
 * البَقّة اللي القاعدة دي بتقفلها: `dailyCapacityExceededExpr` كانت بتاخد `candidateMinutesExpr`
 * و`candidateSpanDaysExpr` **جاهزين من الكولر**، بينما الطلب القائم بيتقاس بـ`perDayMinutesExpr`
 * (اللي فيها قاعدة «يوم كامل لو `estimated_duration_days >= 1`»). يعني نفس الطلب كان بيتحسب
 * **خفيف وهو مرشّح** و**يوم كامل بعد ما يتعيّن** — نفس عدم التماثل اللي ADR-0059 ادّعى إنه قفله
 * بنيويًا، بس من باب الكولر بدل باب المنطق.
 *
 * دلوقتي الكولر بيقول **مصدر بيانات الطلب المرشّح** بس (أعمدته)، والقاعدة نفسها واحدة.
 */
export interface CandidateLoadSource {
  /** تعبير SQL بيرجّع `estimated_duration_days` للطلب المرشّح (أو `NULL`). */
  estimatedDurationDaysExpr: string;
  /** تعبير SQL بيرجّع `duration_minutes` للطلب المرشّح (أو `NULL`). */
  durationMinutesExpr: string;
  /** تعبير SQL بيرجّع المدة الافتراضية للخدمة بالدقايق (أو `NULL`). */
  serviceDefaultMinutesExpr: string;
}

/** دقايق الطلب المرشّح **من كل يوم** — نفس `perDayMinutesExpr` بالحرف، بس على أعمدة المرشّح. */
export function candidatePerDayMinutesExpr(source: CandidateLoadSource, capacityParam: string): string {
  return `CASE
      WHEN (${source.estimatedDurationDaysExpr}) IS NOT NULL AND (${source.estimatedDurationDaysExpr}) >= 1
        THEN ${capacityParam}::int
      ELSE LEAST(
        COALESCE((${source.durationMinutesExpr}), (${source.serviceDefaultMinutesExpr}), ${DEFAULT_JOB_MINUTES}),
        ${capacityParam}::int
      )
    END`;
}

/** أيام الطلب المرشّح — نفس `spanDaysExpr` بالحرف. */
export function candidateSpanDaysFromSource(source: CandidateLoadSource): string {
  return `GREATEST(COALESCE(CEIL(${source.estimatedDurationDaysExpr})::int, 1), 1)`;
}

export interface CapacityConflictOpts extends DayLoadOpts {
  /** parameter لموعد الطلب المرشّح (نص/null — null = النهارده). */
  scheduledAtParam: string;
  /** مصدر أعمدة الطلب المرشّح — القاعدة نفسها بتتطبّق عليه هنا، مش في الكولر. */
  candidateLoad: CandidateLoadSource;
}

/**
 * `true` لو ضم الطلب المرشّح هيعدّي القدرة اليومية في **أي يوم** من أيامه.
 *
 * ده كل قاعدة التعارض الجديدة. متماثلة بالبناء: الطرفين بيتحوّلوا لنفس الوحدة (دقايق/يوم) قبل
 * المقارنة، فمستحيل «أ يشوف ب» من غير «ب يشوف أ».
 */
export function dailyCapacityExceededExpr(opts: CapacityConflictOpts): string {
  const { scheduledAtParam, candidateLoad, dailyCapacityParam } = opts;
  const candidateMinutesExpr = candidatePerDayMinutesExpr(candidateLoad, dailyCapacityParam);
  const candidateSpanDaysExpr = candidateSpanDaysFromSource(candidateLoad);
  const candidateStartDay = `(COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date`;
  return `EXISTS (
    SELECT 1
    FROM generate_series(
      ${candidateStartDay}::timestamp,
      (${candidateStartDay} + (GREATEST(${candidateSpanDaysExpr}, 1) - 1))::timestamp,
      interval '1 day'
    ) AS cd(candidate_day)
    LEFT JOIN ${technicianDayLoadSubquery(opts)} dl ON dl.busy_day = cd.candidate_day::date
    WHERE COALESCE(dl.busy_minutes, 0)
        + LEAST(${candidateMinutesExpr}, ${dailyCapacityParam}::int)
        > ${dailyCapacityParam}::int
  )`;
}

/** أي حاجة عندها `getNumber` — عشان الدالة تحت تتنادى من أي خدمة بلا اعتماد دائري على SettingsService. */
interface NumberSettingReader {
  getNumber(key: string, fallback: number): Promise<number>;
}

/**
 * القدرة اليومية بالدقايق — **نقطة القراءة الوحيدة** للإعداد ده.
 *
 * قبل ADR-0059 كان `matching.full_day_job_minutes` بيتقرا في **14 ملف**، وكل واحد فيهم معرّف
 * نسخته الخاصة من الافتراضي (`const FULL_DAY_JOB_MINUTES_FALLBACK = 360`). تغيير الافتراضي كان
 * لازم يتعمل 14 مرة، وأي واحدة تتنسى تفضل شغّالة برقم مختلف بصمت.
 */
export function resolveDailyCapacityMinutes(settings: NumberSettingReader): Promise<number> {
  return settings.getNumber('matching.daily_capacity_minutes', DAILY_CAPACITY_MINUTES_FALLBACK);
}
