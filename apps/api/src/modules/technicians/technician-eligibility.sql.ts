import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import { dailyCapacityExceededExpr, technicianDayLoadSubquery } from './technician-day-capacity.sql';

/**
 * ADR-0057 (تعميق) — بلاغ مالك حقيقي: «مساعد اتضاف في نفس اليوم لتلات شغلانات كبار، والسيستم
 * ما جابش إن هو شغول». التشخيص الحي كشف السبب الجذري: كل استعلامات التعارض/القدرة الاستيعابية
 * تحت كانت بتفحص `orders.technician_id = X` بس — يعني **التزام الشخص كقائد طلب**. الشخص لما
 * يكون عضو طاقم (مساعد أو فني إضافي، `order_team_members`) على طلب حد تاني، التزامه ده **غير
 * مرئي تمامًا** لكل محرك الجدولة/القدرة الاستيعابية، لأنه مش `orders.technician_id` أصلاً. ده
 * كان بيخلي أي مساعد (اللي بطبيعته دايمًا عضو طاقم مش قائد) شفاف تمامًا لفحص التعارض — بالظبط
 * سيناريو المالك.
 *
 * الدالة دي بترجّع FROM-source بديل لـ`orders X`: كل الطلبات اللي الشخص ملتزم بيها فعليًا، سواء
 * قائد (`orders.technician_id`) أو عضو طاقم (`order_team_members.technician_id`)، بـUNION (مش
 * UNION ALL — لو ظهر نفس الطلب من المصدرين بالغلط، صف واحد بس مايتضاعفش التأثير). العمود
 * `${alias}.id`/`.deleted_at`/`.order_status`/... كلهم بيفضلوا شغالين زي ما هما لأن `SELECT
 * ${alias}.*` بترجع كل أعمدة `orders` الحقيقية بلا استثناء.
 */
function technicianCommittedOrdersSource(technicianIdExpr: string, alias: string): string {
  return `(
        SELECT ${alias}.* FROM orders ${alias} WHERE ${alias}.technician_id = ${technicianIdExpr}
        UNION
        SELECT ${alias}.* FROM orders ${alias}
        JOIN order_team_members ${alias}_otm ON ${alias}_otm.order_id = ${alias}.id
        WHERE ${alias}_otm.technician_id = ${technicianIdExpr}
      ) ${alias}`;
}

/**
 * شرط SQL موحّد لتوافر الفني وقت طلب معيّن — المصدر الوحيد المستخدم حرفيًا في الأماكن الثلاثة
 * اللي بتسأل نفس السؤال ("الفني ده يقدر ياخد الطلب ده فعليًا؟"): matching.service.ts (التوزيع
 * الفعلي)، technicians.service.ts (قايمة اختيار العميل اليدوي)، وtechnician-assignment-guard
 * .service.ts (تعيين الأدمن القسري). راجع ADR-0017 وADR-0018 للتصميم الكامل والسبب.
 *
 * **تصحيح جوهري (ADR-0018، طلب صريح من المالك 2026-08-19)** فوق ADR-0017 الأصلي:
 * - الجدولة **باليوم مش بالساعة** (§2) — `scheduled_at` بقى دايمًا بداية اليوم المطلوب (توقيت
 *   مصر)، فمقارنة تقاطع وقت بالدقيقة (`tstzrange`) بقت بلا معنى (كل طلبات نفس اليوم هتبتدي
 *   بنفس اللحظة بالظبط). التعارض دلوقتي بيتحسب **بمستوى اليوم** — نفس اليوم (بتوقيت مصر
 *   الصحيح، مش UTC الخام) + الشغل ده "شاغل يوم كامل" (`estimated_duration_days >= 1` أو مدة
 *   الخدمة بالدقايق فوق حد `dailyCapacityMinutesParam`).
 * - **طلب الطوارئ "إضافي" مش شاغل يوم كامل** (§9) — الفني اللي عنده طلب مجدول مقبول (accepted)
 *   بس لسه ما بدأش يتحرّك ليه، يقدر يستقبل طوارئ برضه. الاستبعاد للطوارئ بس لو الفني منشغل
 *   جسديًا فعليًا دلوقتي (`ENGAGED_TECHNICIAN_ORDER_STATUSES` — أضيق من الحالات النشطة العادية،
 *   بتستبعد `accepted` عمداً).
 * - **إصلاح توقيت حقيقي**: كل مقارنات اليوم/الساعة هنا بقت `AT TIME ZONE 'Africa/Cairo'` صراحة
 *   بدل الاعتماد على توقيت جلسة Postgres الافتراضي (UTC عادة) — قبل كده `(scheduled_at)::date`
 *   كان ممكن يرجّع اليوم الغلط (يوم قبل اللي العميل فعليًا قصده) لأي وقت بين نص الليل و2 الصبح
 *   بتوقيت مصر، ونفس المشكلة لمقارنة `start_time`/`end_time` (تخزين محلي) ضد وقت UTC خام.
 *
 * **تصحيح تاني جوهري (docs/08 §32، بلاغ مالك حقيقي 2026-08-20)**: قبل التصحيح ده، طلب ASAP
 * (`scheduled_at IS NULL`) غير الطوارئ كان بيتبع قاعدة **مختلفة تمامًا** عن الطلب المجدول — أي
 * طلب نشط للفني (`ACTIVE_TECHNICIAN_ORDER_STATUSES`، بما فيها `accepted` لسه ما بدأش) كان
 * يستبعده بالكامل من أي طلب ASAP جديد، **حتى لو الطلب التاني ده مجدول ليوم بعيد خالص أو قصير
 * جدًا (مش شاغل يوم كامل)**. النتيجة: فني ظاهر "فاضي" في كل شاشات التطبيق (مفيش شغل حالي ظاهر
 * ليه — `findActiveForTechnician()` بيستبعد عمدًا أي طلب مجدول لسه معاداش موعده) كان بيختفي
 * تمامًا من نتائج ASAP لمجرد إن عنده صف `orders` واحد `accepted` معلّق (حتى لو الأسبوع الجاي).
 * العميل يدوس "في أقرب وقت ممكن" أو "اختار الفريق بنفسك" فيلاقي "مفيش فنيين متاحين" رغم إن
 * فنيين حقيقيين متاحين فعلاً — بينما "اختار تاريخ تاني" (نفس اليوم بالظبط) بيشتغل عادي، لأنه
 * بيتبع قاعدة (2) تحت (تعارض يوم + يوم كامل بس). **الإصلاح**: ASAP بقى يتبع **بالحرف نفس قاعدة
 * الطلب المجدول** (يوم=النهاردة بتوقيت مصر) — نفس فلسفة "بوكينج ASAP = بوكينج مجدول ليوم
 * النهاردة، مش نوع مختلف" (طلب صريح من المالك: "خلي عادي البوكينج فلو في اختيار الفريق بنفسك
 * هو هو نفس البوكينج فلو بتاع الجدولة"). حماية ازدواج الحجز الحقيقية (فني يتاخد طلبين فوريين
 * في نفس اللحظة) اتفصلت لشرط مستقل: انشغال جسدي فعلي دلوقتي (`ENGAGED_TECHNICIAN_ORDER_STATUSES`
 * — نفس شرط الطوارئ بالظبط)، بس مطبّق كمان لغير الطوارئ **لو اليوم المطلوب هو النهاردة**
 * (لطلب مجدول ليوم بعيد، انشغال الفني دلوقتي مالوش أي معنى).
 *
 * القاعدة الكاملة دلوقتي:
 *  1. طلب طوارئ (بلا `scheduled_at` بالتعريف) — استبعاد بس لو الفني *منشغل جسديًا فعليًا دلوقتي*
 *     (`ENGAGED_TECHNICIAN_ORDER_STATUSES`).
 *  2. أي طلب تاني (ASAP أو مجدول — نفس القاعدة بالحرف، "اليوم المطلوب" = النهاردة لـASAP):
 *     استبعاد لو (أ) الفني منشغل جسديًا فعليًا دلوقتي **واليوم المطلوب هو النهاردة**، أو (ب) فيه
 *     طلب تاني بموعد **نفس اليوم المطلوب بتوقيت مصر** والشغل ده (القديم أو الجديد) "شاغل يوم
 *     كامل". طلب `accepted` قصير لسه ما بدأش مايستبعدش — الفني يقدر ياخد أكتر من شغلانة قصيرة
 *     في نفس اليوم.
 *  3. الفني حدد بنفسه استثناء `blocked` (يوم كامل أو ساعات مخصصة) بيتقاطع مع وقت الطلب —
 *     لطلب ASAP/طوارئ، "وقت الطلب" = دلوقتي (`now()`)، بتوقيت مصر.
 *
 * الـcaller بيبعت أسماء الـparameters الجاهزة ($N) المتوافقة مع مصفوفة قيم الاستعلام بتاعته،
 * وتعبير SQL لمعرّف الفني ولمدة الخدمة المقدّرة للطلب المرشّح نفسه.
 */
export function technicianAvailabilityCondition(opts: {
  /** تعبير SQL لمعرّف صف الفني الحالي في الاستعلام، مثلاً `tp.id` أو `$1` لو الفني ثابت. */
  technicianIdExpr: string;
  /** parameter لـ`order.scheduledAt` (نص/null) — مثلاً `$10`. */
  scheduledAtParam: string;
  /** parameter لمعرّف الطلب المرشّح نفسه (عشان يستبعد نفسه من فحص التعارض) — مثلاً `$4`. */
  excludeOrderIdParam: string;
  /** parameter لقائمة `ACTIVE_TECHNICIAN_ORDER_STATUSES` — مثلاً `$6`. */
  activeStatusesParam: string;
  /** parameter لقائمة `ENGAGED_TECHNICIAN_ORDER_STATUSES` (ADR-0018 §9) — نفس شكل activeStatusesParam. */
  engagedStatusesParam: string;
  /** parameter بوليان — الطلب المرشّح نفسه طوارئ (`order.bookingMode === EMERGENCY`)؟ */
  isEmergencyParam: string;
  /** تعبير SQL لمدة الخدمة المقدّرة بالدقايق للطلب المرشّح، مثلاً `COALESCE(s.estimated_duration_minutes, 60)`. */
  serviceDurationExpr: string;
  /** مدة دقيقة بالساعات للطلب المرشّح، أو NULL للخدمات المحجوزة باليوم. وجودها يحوّل التعارض
   * إلى تقاطع وقت حقيقي بنطاق نصف مفتوح بدل قاعدة اليوم العامة. */
  preciseDurationHoursExpr?: string;
  /** parameter لـ`matching.daily_capacity_minutes` (السقف اليومي بالدقايق، افتراضي 720 = 12 ساعة) — ADR-0059. */
  dailyCapacityMinutesParam: string;
  /** تعبير SQL لعدد الأيام اللي الطلب المرشّح بيمتد عليها (ناتج محرك التسعير). الافتراضي يوم واحد. */
  candidateSpanDaysExpr?: string;
  /**
   * ADR-0017 بند 10 — Fallback توسيع النطاق لما تنضب قايمة الفنيين "المثاليين". لو `true`، بيتجاهل
   * شروط (1) و(2) (تعارض الطلب النشط) تمامًا — الفني ممكن يترشّح حتى لو مشغول بطلب تاني — لكن
   * شرط (3) (استثناء `blocked` الصريح) وباقي شروط الأهلية الأساسية (خدمة/منطقة/اعتماد) بره
   * الدالة دي بتفضل سارية دايمًا. الهدف: زيادة فرصة توصيل الطلب مع الحفاظ على ملاءمة التخصص —
   * مش بث عشوائي لأي حد.
   */
  ignoreActiveOrderConflict?: boolean;
}): string {
  const { activeStatusesParam, engagedStatusesParam, isEmergencyParam, dailyCapacityMinutesParam, ignoreActiveOrderConflict } = opts;
  const activeOrderConflictConditions = ignoreActiveOrderConflict
    ? // Postgres مايقدرش يستنتج نوع parameter من غير أي إشارة ليه في الاستعلام ("could not
      // determine data type") — تعبيرات دايمًا صحيحة (tautology) لكل الـparameters الجديدة كمان
      // (engagedStatusesParam/isEmergencyParam/dailyCapacityMinutesParam) بلا أي تأثير فعلي.
      `AND (${activeStatusesParam}::order_status[] IS NULL OR ${activeStatusesParam}::order_status[] IS NOT NULL)
       AND (${engagedStatusesParam}::order_status[] IS NULL OR ${engagedStatusesParam}::order_status[] IS NOT NULL)
       AND (${isEmergencyParam}::boolean IS NULL OR ${isEmergencyParam}::boolean IS NOT NULL)
       AND (${dailyCapacityMinutesParam}::int IS NULL OR ${dailyCapacityMinutesParam}::int IS NOT NULL)`
    : `AND NOT (${activeOrderConflictExistsExpr(opts)})`;
  // (3) استثناء صريح (blocked) — الفني حدد بنفسه إنه مش متاح وقت الطلب ده (ASAP/طوارئ = دلوقتي)،
  // كله بتوقيت مصر الصحيح مش UTC الخام. **دايمًا سارية حتى لو ignoreActiveOrderConflict=true**
  // (ADR-0017 بند 10: الشرط ده مايتجاهلش أبدًا، الـfallback بيوسّع تعارض الطلبات بس، مش الاستثناء
  // الذاتي الصريح) — لازم يفضل بعد الـreturn المبكّر القديم اللي كان بيتخطاه بالغلط في أول نسخة
  // من الـrefactor ده (اتلقطت حيًا: matching-work-opportunity.spec.ts فشل بمعنى مختلف، "$10" مش
  // مرتبط بأي تعبير — كان دليل غير مباشر إن الشرط (3) اختفى تمامًا مش بس السبب الظاهري).
  return `
    ${activeOrderConflictConditions}
    AND NOT (${blockedExistsExpr(opts)})
  `;
}

/**
 * تعبير SQL بوليان خام (EXISTS...) بيرجع `true` لو الفني عنده تعارض طلب نشط فعلي وقت الطلب
 * المرشّح — **مصدر الحقيقة الوحيد** لمنطق "التعارض" نفسه، مشترك بين `technicianAvailabilityCondition()`
 * (بتنفيه: `NOT (...)`) و`technicianScheduleConflictCondition()` (بتستخدمه زي ما هو: العكس بالظبط —
 * "مؤهّل بس متعارض"، ADR-0030). تعديل قاعدة التعارض هنا بيتفعّل تلقائيًا في الدالتين، صفر خطر
 * انحراف (drift) بين نسختين منفصلتين لنفس المنطق.
 */
function activeOrderConflictExistsExpr(opts: {
  technicianIdExpr: string;
  scheduledAtParam: string;
  excludeOrderIdParam: string;
  activeStatusesParam: string;
  engagedStatusesParam: string;
  isEmergencyParam: string;
  serviceDurationExpr: string;
  preciseDurationHoursExpr?: string;
  dailyCapacityMinutesParam: string;
  candidateSpanDaysExpr?: string;
}): string {
  const {
    technicianIdExpr,
    scheduledAtParam,
    excludeOrderIdParam,
    activeStatusesParam,
    engagedStatusesParam,
    isEmergencyParam,
    serviceDurationExpr,
    preciseDurationHoursExpr = 'NULL',
    dailyCapacityMinutesParam,
    candidateSpanDaysExpr = '1',
  } = opts;
  return `
    -- اليوم المطلوب للطلب المرشّح نفسه (ASAP = النهاردة، مجدول = يوم scheduled_at) — بتوقيت مصر.
    (
      -- (1) طوارئ: تعارض بس لو الفني منشغل جسديًا فعليًا دلوقتي (ADR-0018 §9 — طلب مقبول
      -- لسه ما بدأش مش "شغل" لغرض الطوارئ).
      (
        ${isEmergencyParam}::boolean IS TRUE
        AND EXISTS (
          SELECT 1 FROM ${technicianCommittedOrdersSource(technicianIdExpr, 'bo')}
          WHERE bo.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
            AND bo.order_status = ANY(${engagedStatusesParam}::order_status[]) AND bo.deleted_at IS NULL
        )
      )
      OR
      -- (2) تعارض **وقت** حقيقي في نفس اليوم: إما نافذة زمنية متقاطعة فعليًا (خدمات الوقت
      -- الدقيق)، أو الفني منشغل جسديًا دلوقتي واليوم المطلوب هو النهاردة. قاعدة «شاغل يوم كامل»
      -- القديمة اتشالت من هنا بالكامل — بقت مسؤولية السقف اليومي في (3) تحت (ADR-0059).
      (
        ${isEmergencyParam}::boolean IS NOT TRUE
        AND EXISTS (
          SELECT 1 FROM ${technicianCommittedOrdersSource(technicianIdExpr, 'co')}
          JOIN services cs ON cs.id = co.service_id
          WHERE co.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
            AND co.order_status = ANY(${activeStatusesParam}::order_status[]) AND co.deleted_at IS NULL
            AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date
                = (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date
            AND (
              -- الخدمات ذات الوقت الدقيق تحجز نافذة فعلية. النطاق نصف مفتوح يسمح بموعدين
              -- متجاورين، ويرفض فقط التقاطع الحقيقي حتى لو كانت الخدمتان قصيرتين.
              (
                ${scheduledAtParam}::timestamptz IS NOT NULL
                AND (${preciseDurationHoursExpr}) IS NOT NULL
                AND co.scheduled_at IS NOT NULL
                AND COALESCE(co.duration_minutes, co.duration_hours * 60) IS NOT NULL
                AND co.scheduled_at < ${scheduledAtParam}::timestamptz
                    + ((${preciseDurationHoursExpr}) || ' hours')::interval
                AND co.scheduled_at + (COALESCE(co.duration_minutes, co.duration_hours * 60) || ' minutes')::interval
                    > ${scheduledAtParam}::timestamptz
              )
              OR
              (
                (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date
                  = (now() AT TIME ZONE 'Africa/Cairo')::date
                AND co.order_status = ANY(${engagedStatusesParam}::order_status[])
              )
            )
        )
      )
      OR
      -- (3) **ADR-0059 — السقف اليومي بالساعات**. ده اللي بدّل قاعدة «شاغل يوم كامل» القديمة:
      -- بدل بوليان بيسأل «الطلب القديم كبير؟» (وبيدّي إجابة مختلفة حسب مين بيسأل)، بنجمع
      -- الدقايق المشغولة فعلاً في كل يوم من أيام الطلب الجديد ونقارنها بالسقف. متماثل بالبناء،
      -- وبيشوف الشغل الممتد على أيامه كلها مش يوم بدايته بس.
      (
        ${isEmergencyParam}::boolean IS NOT TRUE
        AND ${dailyCapacityExceededExpr({
          technicianIdExpr,
          activeStatusesParam,
          excludeOrderIdParam,
          dailyCapacityParam: dailyCapacityMinutesParam,
          scheduledAtParam,
          candidateMinutesExpr: serviceDurationExpr,
          candidateSpanDaysExpr: candidateSpanDaysExpr,
        })}
      )
    )`;
}

/** تعبير SQL بوليان خام لاستثناء `blocked` الصريح — نفس فلسفة {@link activeOrderConflictExistsExpr} فوق. */
function blockedExistsExpr(opts: {
  technicianIdExpr: string;
  scheduledAtParam: string;
  serviceDurationExpr: string;
}): string {
  const { technicianIdExpr, scheduledAtParam, serviceDurationExpr } = opts;
  return `
    EXISTS (
      SELECT 1 FROM technician_schedule_slots tss
      WHERE tss.technician_id = ${technicianIdExpr} AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND tss.slot_date = (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date
        AND tss.start_time < ((COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')
              + (${serviceDurationExpr} || ' minutes')::interval)::time
        AND tss.end_time > (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::time
    )`;
}

/**
 * "مؤهّل بس متعارض جدوليًا" (ADR-0030، docs/08 §42) — العكس الدقيق لـ`technicianAvailabilityCondition()`:
 * فني عنده تعارض طلب نشط فعلي (نفس منطق {@link activeOrderConflictExistsExpr})، **لكن** مش
 * `blocked` صراحة (استثناء ذاتي زي إجازة — ده يفضل مخفي تمامًا دايمًا، الفئة التالتة "غير مؤهّل"،
 * مش "متعارض"). الـcaller مسؤول عن باقي بوابة الأهلية الصارمة (خدمة/فئة/منطقة/current_location) —
 * نفس الـWHERE clause الأساسي المستخدم مع `technicianAvailabilityCondition()`، الفرق هنا في شرط
 * التوافر بس.
 */
export function technicianScheduleConflictCondition(opts: {
  technicianIdExpr: string;
  scheduledAtParam: string;
  excludeOrderIdParam: string;
  activeStatusesParam: string;
  engagedStatusesParam: string;
  isEmergencyParam: string;
  serviceDurationExpr: string;
  preciseDurationHoursExpr?: string;
  dailyCapacityMinutesParam: string;
  candidateSpanDaysExpr?: string;
}): string {
  return `
    AND (${activeOrderConflictExistsExpr(opts)})
    AND NOT (${blockedExistsExpr(opts)})
  `;
}

export type TechnicianCapacityTier = 'LIGHT' | 'MEANINGFUL' | 'HEAVY' | 'BLOCKED';

/**
 * تصنيف القدرة الاستيعابية بـ4 مستويات (docs/08 §34.1، ADR-0020 §1) — دالة **جديدة** فوق نفس
 * شروط `technicianAvailabilityCondition()` (بلا تكرار منطق)، بترجّع تصنيف بدل بوليان بسيط. الفرق
 * الوحيد عن الدالة فوق: بتفرّق سبب الاستبعاد (`HEAVY`) عن "عنده شغل لكن مش شاغل يومه بالكامل"
 * (`MEANINGFUL`، تصنيف جديد ماكانش موجود قبل كده — الدالة القديمة كانت بتعتبره ببساطة "مؤهّل").
 *
 * الأولوية بالترتيب (زي `technicianAvailabilityCondition()` بالحرف — `blocked` بياخد الأولوية
 * فوق أي تعارض طلبات):
 *  1. `BLOCKED` — استثناء `blocked` صريح حدده الفني بنفسه بيغطي وقت الطلب.
 *  2. `HEAVY` — تعارض حقيقي: انشغال جسدي فعلي دلوقتي (لو اليوم = النهاردة) أو "شاغل يوم كامل".
 *  3. `MEANINGFUL` — عنده طلب نشط تاني بنفس اليوم، لكن مش `HEAVY` (شغل قصير/خفيف).
 *  4. `LIGHT` — لا تعارض خالص.
 *
 * مش مصمّمة لطلبات الطوارئ (الطوارئ ليها مسار `order_assignments` منفصل تمامًا، `dispatchNext
 * Round()`، بلا تغيير) — بتُستخدم بس من `autoConfirmScheduledOrder()` قبل قرار التأكيد التلقائي.
 */
export async function classifyTechnicianCapacity(
  dataSource: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]> },
  params: {
    technicianId: string;
    /** موعد الطلب المرشّح (`order.scheduledAt`) — `null` = ASAP/اليوم. */
    scheduledAt: Date | string | null;
    /** معرّف الطلب المرشّح نفسه، عشان يستبعد نفسه من فحص التعارض. `null` لو مفيش طلب مرشّح فعلي
     * (استخدام تشخيصي بس، زي معاينة قدرة الفني للأدمن — docs/08 §34.4). */
    excludeOrderId: string | null;
    /** مدة الخدمة المقدّرة بالدقايق للطلب المرشّح. */
    serviceDurationMinutes: number;
    dailyCapacityMinutes: number;
    /** عدد أيام الطلب المرشّح (ناتج محرك التسعير) — الافتراضي يوم واحد. */
    candidateSpanDays?: number;
  },
): Promise<TechnicianCapacityTier> {
  const rows = await dataSource.query<{ tier: TechnicianCapacityTier }>(
    `
    WITH target AS (
      SELECT (COALESCE($2::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date AS target_date
    ),
    blocked AS (
      SELECT 1 FROM technician_schedule_slots tss, target
      WHERE tss.technician_id = $1 AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND tss.slot_date = target.target_date
        AND tss.start_time < ((COALESCE($2::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')
              + ($5::int || ' minutes')::interval)::time
        AND tss.end_time > (COALESCE($2::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::time
      LIMIT 1
    ),
    -- ADR-0059 — نفس حسبة السقف اليومي بالحرف اللي technicianAvailabilityCondition() بتستخدمها.
    -- قبل كده كان هنا **منطق تاني** بقاعدة «شاغل يوم كامل»، فالتصنيف والتوافر كانوا ممكن
    -- يختلفوا على نفس الفني (التصنيف يقول MEANINGFUL والتوزيع يستبعده، أو العكس).
    load_today AS (
      SELECT COALESCE(dl.busy_minutes, 0) AS busy_minutes
      FROM target
      LEFT JOIN ${technicianDayLoadSubquery({
        technicianIdExpr: '$1',
        activeStatusesParam: '$6',
        excludeOrderIdParam: '$3',
        dailyCapacityParam: '$4',
      })} dl ON dl.busy_day = target.target_date
    ),
    heavy AS (
      SELECT 1 WHERE ${dailyCapacityExceededExpr({
        technicianIdExpr: '$1',
        activeStatusesParam: '$6',
        excludeOrderIdParam: '$3',
        dailyCapacityParam: '$4',
        scheduledAtParam: '$2',
        candidateMinutesExpr: '$5::int',
        candidateSpanDaysExpr: '$8::int',
      })}
      UNION ALL
      -- منشغل جسديًا دلوقتي واليوم المطلوب هو النهاردة — ده مش سقف ساعات، ده «مش قادر يتحرك».
      SELECT 1 FROM ${technicianCommittedOrdersSource('$1', 'eo')}, target
      WHERE eo.id IS DISTINCT FROM $3::uuid AND eo.deleted_at IS NULL
        AND eo.order_status = ANY($7::order_status[])
        AND target.target_date = (now() AT TIME ZONE 'Africa/Cairo')::date
      LIMIT 1
    )
    SELECT
      CASE
        WHEN EXISTS (SELECT 1 FROM blocked) THEN 'BLOCKED'
        WHEN EXISTS (SELECT 1 FROM heavy) THEN 'HEAVY'
        WHEN (SELECT busy_minutes FROM load_today) > 0 THEN 'MEANINGFUL'
        ELSE 'LIGHT'
      END AS tier
    `,
    [
      params.technicianId,
      params.scheduledAt,
      params.excludeOrderId,
      params.dailyCapacityMinutes,
      params.serviceDurationMinutes,
      ACTIVE_TECHNICIAN_ORDER_STATUSES,
      ENGAGED_TECHNICIAN_ORDER_STATUSES,
      params.candidateSpanDays ?? 1,
    ],
  );
  return rows[0].tier;
}

export interface TechnicianCapacityDescription {
  tier: TechnicianCapacityTier;
  /** سبب مقروء بالعربي — نص جاهز للعرض المباشر في شاشة الأدمن (docs/08 §34.4، بند W). */
  reasonAr: string;
  /** نطاق تاريخ الشغل الشاغل ليوم الفني (لو السبب مشروع متعدد الأيام) — `null` لو مش منطبق. */
  occupiedFrom: string | null;
  occupiedTo: string | null;
}

/**
 * نسخة تشخيصية لشفافية الأدمن (docs/08 §34.4، ADR-0020 §W) — بتلف حوالين `classifyTechnicianCapacity()`
 * وبترجع سبب مقروء + نطاق الأيام المشغولة لو موجود، بدل تصنيف خام بس. `excludeOrderId=null` +
 * `serviceDurationMinutes` عام (60 دقيقة افتراضي) لأنه مفيش طلب مرشّح فعلي هنا — معاينة عامة
 * "الفني ده متاح إمتى" مش قرار مطابقة حقيقي.
 */
export async function describeTechnicianCapacity(
  dataSource: { query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]> },
  params: { technicianId: string; date: string; dailyCapacityMinutes: number },
): Promise<TechnicianCapacityDescription> {
  const tier = await classifyTechnicianCapacity(dataSource, {
    technicianId: params.technicianId,
    scheduledAt: `${params.date}T00:00:00`,
    excludeOrderId: null,
    serviceDurationMinutes: 60,
    dailyCapacityMinutes: params.dailyCapacityMinutes,
  });

  if (tier === 'BLOCKED') {
    const [slot] = await dataSource.query<{ slot_date: string }>(
      `SELECT TO_CHAR(slot_date, 'YYYY-MM-DD') AS slot_date FROM technician_schedule_slots
       WHERE technician_id = $1 AND status = 'blocked' AND deleted_at IS NULL AND slot_date = $2::date
       LIMIT 1`,
      [params.technicianId, params.date],
    );
    return {
      tier,
      reasonAr: 'الفني حظر اليوم ده بنفسه صراحة (إجازة/استثناء شخصي)',
      occupiedFrom: slot?.slot_date ?? params.date,
      occupiedTo: slot?.slot_date ?? params.date,
    };
  }

  if (tier === 'LIGHT') {
    return { tier, reasonAr: 'الفني فاضي أو حِمله خفيف — مؤهّل للتأكيد التلقائي العادي', occupiedFrom: null, occupiedTo: null };
  }

  // MEANINGFUL أو HEAVY — نلاقي الطلب اللي مسبّب التصنيف عشان نبني السبب + النطاق. لو أكتر من
  // طلب، بناخد الأطول مدة (الأقرب لتفسير "ليه" بالنسبة للأدمن).
  const [cause] = await dataSource.query<
    { order_number: string; estimated_duration_days: number | null; scheduled_at_date: string | null; order_status: string }
  >(
    `SELECT o.order_number, o.estimated_duration_days, o.order_status,
            TO_CHAR((COALESCE(o.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM-DD') AS scheduled_at_date
     FROM ${technicianCommittedOrdersSource('$1', 'o')}
     WHERE o.deleted_at IS NULL
       AND o.order_status = ANY($3::order_status[])
       AND (COALESCE(o.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date = $2::date
     ORDER BY COALESCE(o.estimated_duration_days, 0) DESC
     LIMIT 1`,
    [params.technicianId, params.date, ACTIVE_TECHNICIAN_ORDER_STATUSES],
  );

  const durationDays = Math.max(1, cause?.estimated_duration_days ?? 1);
  const fromDate = cause?.scheduled_at_date ?? params.date;
  const toDate = new Date(new Date(`${fromDate}T00:00:00Z`).getTime() + (durationDays - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  if (tier === 'HEAVY') {
    return {
      tier,
      reasonAr: cause
        ? `الفني عنده شغل شاغل يومه بالكامل (طلب ${cause.order_number}${durationDays > 1 ? `، ${durationDays} أيام` : ''})`
        : 'الفني منشغل جسديًا فعليًا دلوقتي',
      occupiedFrom: fromDate,
      occupiedTo: toDate,
    };
  }

  return {
    tier,
    reasonAr: cause
      ? `الفني عنده شغل قصير نفس اليوم (طلب ${cause.order_number}) — لسه مؤهّل لفرصة اختيارية`
      : 'الفني عنده شغل قصير نفس اليوم — لسه مؤهّل لفرصة اختيارية',
    occupiedFrom: fromDate,
    occupiedTo: fromDate,
  };
}

/**
 * شرط SQL موحّد **لتأهيل الفني للخدمة** (ADR-0018 §8 + ADR-0049) — نفس فلسفة
 * `technicianAvailabilityCondition()` فوق بالظبط: مصدر واحد بدل نسخ ولصق.
 *
 * **ليه الدالة دي اتعملت أصلاً**: الشرط ده (`technician_services` مباشر **أو**
 * `technician_categories` للفئة) كان مكتوب حرفيًا في **تسع** استعلامات مختلفة — التوزيع الفعلي،
 * قوايم اختيار العميل (تلاتة)، تعيين الأدمن القسري، إضافة عضو فريق، مطابقة المساعدين، وشاشتين
 * تشخيص. وتعليق في `technicians.service.ts` كان بيعترف بالتكرار ده صراحةً.
 *
 * التكرار ده كان مقبول طول ما القاعدة قاعدة واحدة بسيطة. أول ما اتضاف ليها **الحجب** (ADR-0049)
 * بقى خطر حقيقي: تطبيقه على تمنية من تسعة معناه إن الفني المحجوب يفضل بيوصله الشغل من المسار
 * المنسي، **والأدمن شايف في الواجهة إنه محجوب** — تسريب صامت أسوأ من عدم بناء الميزة أصلاً.
 *
 * الشرط بيتكوّن من جزئين لازم يتحققوا مع بعض، لنفس الشخص سواء شغال في الطلب كفني أو مساعد:
 *  1. **مؤهّل**: صف خدمة مباشر معتمد، أو اعتماد الفئة كلها.
 *  2. **مش محجوب**: مفيش صف في `technician_excluded_services` للفني/الخدمة دول.
 */
export function technicianServiceQualificationCondition(opts: {
  /** تعبير SQL لمعرّف الفني، مثلاً `tp.id` أو `member.id` أو `$1`. */
  technicianIdExpr: string;
  /** تعبير SQL لمعرّف الخدمة المطلوبة، مثلاً `$1` أو `svc.id` أو `s.id`. */
  serviceIdExpr: string;
  /** تعبير SQL لمعرّف فئة الخدمة، مثلاً `s.category_id` أو `svc.category_id`. */
  categoryIdExpr: string;
  /**
   * alias لـ`LEFT JOIN technician_services` لو الاستعلام عامله بالفعل (مثلاً `ts`) — بنستخدم
   * `<alias>.id IS NOT NULL` زي ما كان بالظبط. لو مش موجود، الدالة بتبني `EXISTS` بنفسها.
   */
  directServiceAlias?: string;
}): string {
  // قايمة الحجب مشتركة بين الدورين — غياب الصف = مسموح، فمالهاش أي أثر لحد ما الأدمن يحجب فعلاً.
  const notExcluded = `NOT EXISTS (
          SELECT 1 FROM technician_excluded_services tes
          WHERE tes.technician_id = ${opts.technicianIdExpr}
            AND tes.service_id = ${opts.serviceIdExpr}
        )`;

  const directlyApproved = opts.directServiceAlias
    ? `${opts.directServiceAlias}.id IS NOT NULL`
    : `EXISTS (
             SELECT 1 FROM technician_services direct_svc
             WHERE direct_svc.technician_id = ${opts.technicianIdExpr}
               AND direct_svc.service_id = ${opts.serviceIdExpr}
               AND direct_svc.is_active = true
               AND direct_svc.verification_status = 'approved'
           )`;

  return `(
          ${directlyApproved}
          OR EXISTS (
            SELECT 1 FROM technician_categories tec_cat
            WHERE tec_cat.technician_id = ${opts.technicianIdExpr}
              AND tec_cat.category_id = ${opts.categoryIdExpr}
              AND tec_cat.is_active = true AND tec_cat.verification_status = 'approved'
          )
        )
        -- ADR-0049 — حجب الأدمن لخدمة بعينها عن الفني ده. مفروض على الدورين.
        AND ${notExcluded}`;
}

/**
 * هل الشخص مخدوم له نفس **مدينة** نطاق الطلب؟
 *
 * المساعد يقدر يتحرك بين كل نطاقات المدينة الواحدة حتى لو الأدمن عيّن له نطاقًا واحدًا فقط،
 * لكن لا يتسرّب من مدينة لمدينة (القاهرة لا تظهر لطلب الإسكندرية). المسافة تظل عامل ترتيب بعد
 * هذا الحاجز، وليست بديلًا عنه. الدالة مشتركة بين العرض التلقائي، المساعد الشخصي، الضم اليدوي
 * وحارس التنفيذ حتى لا تختلف القائمة عن قرار الحفظ الفعلي.
 */
export function technicianCityCoverageCondition(opts: {
  technicianIdExpr: string;
  requestedServiceZoneIdExpr: string;
}): string {
  return `EXISTS (
          SELECT 1
          FROM technician_zones city_tz
          JOIN service_zones technician_zone ON technician_zone.id = city_tz.service_zone_id
          JOIN service_zones requested_zone ON requested_zone.id = ${opts.requestedServiceZoneIdExpr}
          WHERE city_tz.technician_id = ${opts.technicianIdExpr}
            AND city_tz.is_active = true
            AND city_tz.deleted_at IS NULL
            AND technician_zone.is_active = true
            AND technician_zone.deleted_at IS NULL
            AND requested_zone.is_active = true
            AND requested_zone.deleted_at IS NULL
            AND technician_zone.city_id = requested_zone.city_id
        )`;
}

/**
 * فلترة على **دور الشخص** — فني كامل ولا مساعد (ADR-0050، docs/08 §94، طلب مالك مباشر).
 *
 * **ليه helper منفصل مش شرط جوّه `technicianServiceQualificationCondition`؟** الدالة دي مشتركة
 * بين مسارات الفني **والمساعد** الاتنين (بث مجمع المساعدين بيستخدمها بالحرف) — حقن شرط "مش مساعد"
 * جواها كان هيمنع المساعدين من إنهم يبقوا مساعدين، يعني يكسر الميزة نفسها. الفصل ده مقصود، ونفس
 * شكل `technicianAvailabilityCondition` المُعامَل بالفعل فوق.
 *
 * - `'technician'` → مسارات القيادة/التوزيع/اختيار العميل: **المساعدين مستبعدين**.
 * - `'assistant'` → مجمع المساعدين وضم مساعد لطاقم: **الفنيين مستبعدين** (الاتجاه العكسي).
 */
export function technicianKindCondition(opts: {
  /** تعبير SQL لمعرّف صف الفني، مثلاً `tp` أو `member` (الـalias مش الـid — بنقرا العمود منه). */
  technicianAlias: string;
  kind: 'technician' | 'assistant';
}): string {
  return `${opts.technicianAlias}.technician_kind = '${opts.kind}'`;
}
