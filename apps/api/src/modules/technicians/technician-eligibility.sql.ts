import { ACTIVE_TECHNICIAN_ORDER_STATUSES, ENGAGED_TECHNICIAN_ORDER_STATUSES } from '../orders/order-state-machine';
import {
  CandidateLoadSource,
  candidateSpanDaysFromSource,
  dailyCapacityExceededExpr,
  technicianDayLoadSubquery,
} from './technician-day-capacity.sql';

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
 * **تصحيح تالت جوهري (ADR-0070، طلب مالك صريح 2026-09-04)** — «الفني شغّال دلوقتي» بطل يكون
 * سبب استبعاد أصلاً. الحالة اللي المالك وصفها: «طالما الشغلانة جارية هو ما ينفعش يقبل شغل تاني،
 * فدي مشكلة». قاعدة ENGAGED القديمة كانت بتخفي الفني اللي في الشارع عن **كل** فرص نفس اليوم
 * حتى لو الشغلانة الجديدة معادها بعد ما يخلص، وحتى لو يومه فاضي بالكامل بعدها. القاعدة اللي
 * حلّت محلها هي بالظبط اللي المالك نطقها: «لو جاله شغلانة تانية ما بتتعارضش مع مواعيده في نفس
 * اليوم، ومجموع الشغل أقل من عدد الساعات المسموح أو يساويه — مفيش مشكلة».
 *
 * القاعدة الكاملة دلوقتي — **واحدة لكل أوضاع الحجز، بلا استثناء للطوارئ**:
 *  1. **تعارض وقت حقيقي**: الخدمات ذات الوقت الدقيق بتحجز نافذة فعلية، والتقاطع بينها بيستبعد
 *     (نطاق نصف مفتوح، فموعدين متجاورين مسموحين). الطلب بلا موعد محدد (ASAP/طوارئ) مالوش نافذة
 *     يتقارن بيها، فالفرع ده مابينطبقش عليه.
 *  2. **السقف اليومي** (`matching.daily_capacity_minutes`، افتراضي 720 = 12 ساعة): مجموع دقايق
 *     الشغل الملتزم بيه في كل يوم من أيام الطلب الجديد + دقايق الطلب الجديد لازم يفضل ≤ السقف.
 *     ده بقى الحارس الوحيد ضد التحميل الزايد، وهو نفسه **الزرار اللي الأدمن بيضبطه** لو عايز
 *     يشدّد أو يوسّع. الطوارئ بقت داخلة تحته زي أي شغل تاني (كانت مستثناة).
 *  3. الفني حدد بنفسه استثناء `blocked` (يوم كامل أو ساعات مخصصة) بيتقاطع مع وقت الطلب —
 *     لطلب ASAP/طوارئ، "وقت الطلب" = دلوقتي (`now()`)، بتوقيت مصر. **مايتجاهلش أبدًا.**
 *
 * **الأثر المقصود والمقايضة الصريحة**: فني `in_progress` دلوقتي بقى يقدر ياخد شغل تاني نفس
 * اليوم طالما السقف مسمح. للخدمات اللي بتتحجز باليوم (بلا وقت بداية) مفيش معلومة وقت تفرّق بين
 * «دلوقتي» و«بعد ساعتين»، فالسقف اليومي هو الضمانة الوحيدة — وده مقبول بقرار المالك. الفني
 * كمان بيقدر يرفض أي عرض، والاستثناء الصريح (`blocked`) لسه شغّال بالكامل.
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
  /**
   * **مصدر أعمدة الحمل التشغيلي للطلب المرشّح** (ADR-0061 §2).
   *
   * قبل كده كان الكولر بيبعت «دقايق المرشّح» و«أيامه» كتعبيرين جاهزين، وده اللي خلّى المرشّح
   * يتقاس بمسطرة غير اللي هيتقاس بيها بعد التعيين. دلوقتي الكولر بيقول أعمدته بس، والقاعدة
   * واحدة في `candidatePerDayMinutesExpr`.
   *
   * لو مابعتش حاجة، الافتراضي بيرجّع لسلوك «مدة الخدمة الافتراضية ليوم واحد».
   */
  candidateLoad?: CandidateLoadSource;
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
  /** مصدر أعمدة الحمل التشغيلي للطلب المرشّح (ADR-0061 §2). */
  candidateLoad?: CandidateLoadSource;
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
    candidateLoad,
  } = opts;
  const candidateLoadSource: CandidateLoadSource = candidateLoad ?? {
    estimatedDurationDaysExpr: 'NULL',
    durationMinutesExpr: serviceDurationExpr,
    serviceDefaultMinutesExpr: 'NULL',
  };
  return `
    -- اليوم المطلوب للطلب المرشّح نفسه (ASAP/طوارئ = النهاردة، مجدول = يوم scheduled_at) —
    -- بتوقيت مصر. قاعدة واحدة لكل أوضاع الحجز (ADR-0070): تعارض وقت حقيقي، أو تجاوز السقف
    -- اليومي. مفيش استبعاد لمجرد إن الفني «شغّال دلوقتي».
    (
      -- (1) تعارض **وقت** حقيقي في نفس اليوم — بيسري بس على الخدمات ذات الوقت الدقيق (اللي
      -- بتحجز نافذة فعلية). النطاق نصف مفتوح بيسمح بموعدين متجاورين ويرفض التقاطع الحقيقي بس.
      -- طلب الطوارئ بلا scheduled_at بالتعريف، فالفرع ده مابينطبقش عليه — وده مقصود: مفيش
      -- نافذة معلومة تتقارن بيها.
      EXISTS (
        SELECT 1 FROM ${technicianCommittedOrdersSource(technicianIdExpr, 'co')}
        JOIN services cs ON cs.id = co.service_id
        WHERE co.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
          AND co.order_status = ANY(${activeStatusesParam}::order_status[]) AND co.deleted_at IS NULL
          AND (COALESCE(co.scheduled_at, now()) AT TIME ZONE 'Africa/Cairo')::date
              = (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date
          AND ${scheduledAtParam}::timestamptz IS NOT NULL
          AND (${preciseDurationHoursExpr}) IS NOT NULL
          AND co.scheduled_at IS NOT NULL
          AND COALESCE(co.duration_minutes, co.duration_hours * 60) IS NOT NULL
          AND co.scheduled_at < ${scheduledAtParam}::timestamptz
              + ((${preciseDurationHoursExpr}) || ' hours')::interval
          AND co.scheduled_at + (COALESCE(co.duration_minutes, co.duration_hours * 60) || ' minutes')::interval
              > ${scheduledAtParam}::timestamptz
      )
      OR
      -- (2) **السقف اليومي بالساعات** (ADR-0059) — دلوقتي بيسري على **كل** أوضاع الحجز بما فيها
      -- الطوارئ (ADR-0070). ده الحارس الوحيد المتبقي ضد التحميل الزايد، وهو بالظبط القاعدة اللي
      -- المالك طلبها: «مجموع الشغل أقل من عدد الساعات المسموح أو يساويه».
      ${dailyCapacityExceededExpr({
        technicianIdExpr,
        activeStatusesParam,
        excludeOrderIdParam,
        dailyCapacityParam: dailyCapacityMinutesParam,
        scheduledAtParam,
        candidateLoad: candidateLoadSource,
      })}
      -- الـparameters دي بقت غير مستخدمة في القاعدة (ADR-0070 شال قاعدة ENGAGED)، بس بتفضل
      -- مربوطة بتعبير دايمًا صحيح: كل الكولرز بيبعتوا مصفوفة قيم بترتيب ثابت، وشيلها كان
      -- هيعيد ترقيم كل الـ$N في أربع استعلامات كبيرة مقابل صفر مكسب سلوكي.
      OR (${engagedStatusesParam}::order_status[] IS NOT NULL AND FALSE)
      OR (${isEmergencyParam}::boolean IS NOT NULL AND FALSE)
    )`;
}

/**
 * تعبير SQL بوليان خام لاستثناء `blocked` الصريح — نفس فلسفة {@link activeOrderConflictExistsExpr} فوق.
 *
 * **إصلاح مثبت بالتشغيل الحي (docs/system-audit §134، سيناريوهات E2/E3)** — النسخة القديمة كانت
 * بتقارن `time` مقصوصة على **يوم البداية بس**، فكانت بتسيب تلات ثغرات حقيقية:
 *
 *  1. **شغل ممتد على أكتر من يوم**: إجازة الفني في نص المدة (اليوم التالت من خمسة مثلاً) كانت
 *     **غير مرئية تمامًا** — الفلتر بيبص على `slot_date = يوم البداية` وبس، فالفني بياخد شغل
 *     جوّه إجازة حدّدها بنفسه. (السقف اليومي في ADR-0059 بيفرد الشغل على أيامه كلها بـ
 *     `generate_series`، لكن الاستثناء الصريح فضل على يوم واحد — انحراف بين قاعدتين المفروض
 *     يشوفوا نفس المدة.)
 *  2. **شغل بيعدّي نص الليل**: `(وقت + مدة)::time` بتلف حوالين ٠٠:٠٠ (٢٢:٠٠ + ٤ ساعات ⇒ ٠٢:٠٠)،
 *     فالمقارنة `start_time < 02:00` بترفض إجازة ٢٣:٠٠–٢٣:٥٩ رغم إنها متقاطعة فعليًا.
 *  3. نفس اللفة كانت ممكن تدّي تقاطعًا وهميًا في الاتجاه التاني كمان.
 *
 * الإصلاح: تقاطع **timestamps حقيقية** (نصف مفتوح) بدل مقارنة `time`. نافذة الإجازة بتتحوّل من
 * (تاريخ + وقت محلي) لـ`timestamptz` بتوقيت مصر، ونافذة الشغل المرشّح بتمتد على أيامه كلها
 * (`spanDays - 1` يوم + مدة اليوم) — فالإجازة في أي يوم من أيام الشغل بتتلقط.
 */
function blockedExistsExpr(opts: {
  technicianIdExpr: string;
  scheduledAtParam: string;
  serviceDurationExpr: string;
  candidateLoad?: CandidateLoadSource;
}): string {
  const { technicianIdExpr, scheduledAtParam, serviceDurationExpr, candidateLoad } = opts;
  const spanDaysExpr = candidateLoad ? candidateSpanDaysFromSource(candidateLoad) : '1';
  const candidateStart = `COALESCE(${scheduledAtParam}::timestamptz, now())`;
  // نهاية النافذة = البداية + (أيام الشغل - 1) + مدة اليوم. لشغل يوم واحد بترجع للسلوك الصح
  // القديم بالظبط (بداية + المدة)، فمفيش إفراط في التقييد لإجازة مش متقاطعة.
  const candidateEnd = `(${candidateStart}
        + ((GREATEST(${spanDaysExpr}, 1) - 1) || ' days')::interval
        + (${serviceDurationExpr} || ' minutes')::interval)`;
  return `
    EXISTS (
      SELECT 1 FROM technician_schedule_slots tss
      WHERE tss.technician_id = ${technicianIdExpr} AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND (tss.slot_date + tss.start_time) AT TIME ZONE 'Africa/Cairo' < ${candidateEnd}
        AND (tss.slot_date + tss.end_time) AT TIME ZONE 'Africa/Cairo' > ${candidateStart}
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
  /** مصدر أعمدة الحمل التشغيلي للطلب المرشّح (ADR-0061 §2). */
  candidateLoad?: CandidateLoadSource;
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
    /**
     * `estimated_duration_days` **للطلب المرشّح كما هي** — ناتج محرك التسعير، و`null` لو المحرك
     * ماحددش أيام (شغلانة بتتقاس بالدقايق).
     *
     * **متعمّد إنها nullable ومش بتتحوّل لـ1**: القيمة دي بتتقرا هنا بنفس قاعدة الطلب القائم
     * (`perDayMinutesExpr`) — «موجودة و>= 1» معناها الشغلانة بتاخد اليوم بالكامل. أول نسخة من
     * ADR-0061 §2 كانت بتبعت `candidateSpanDays ?? 1`، فـ«يوم واحد افتراضي» بقى مفهوش فرق عن
     * «المحرك قال يوم كامل»، وكل مرشّح — حتى شغلانة 3 ساعات — بقى بياخد الـ12 ساعة كلها ⇒ كل
     * الفنيين `HEAVY`. الاختبارات الحية مسكتها فورًا.
     */
    candidateEstimatedDurationDays?: number | null;
  },
): Promise<TechnicianCapacityTier> {
  const rows = await dataSource.query<{ tier: TechnicianCapacityTier }>(
    `
    WITH target AS (
      SELECT (COALESCE($2::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date AS target_date
    ),
    -- نفس تقاطع الـtimestamps الحقيقي بتاع blockedExistsExpr بالحرف — بيغطي أيام الشغل
    -- الممتد كلها وبيعدّي نص الليل صح. (كان هنا نفس بَقّة الـ::time الملفوفة، فالتصنيف كان
    -- ممكن يقول LIGHT لفني في إجازة صريحة.)
    blocked AS (
      SELECT 1 FROM technician_schedule_slots tss
      WHERE tss.technician_id = $1 AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND (tss.slot_date + tss.start_time) AT TIME ZONE 'Africa/Cairo'
            < (COALESCE($2::timestamptz, now())
                + ((GREATEST(COALESCE(CEIL($8::numeric)::int, 1), 1) - 1) || ' days')::interval
                + ($5::int || ' minutes')::interval)
        AND (tss.slot_date + tss.end_time) AT TIME ZONE 'Africa/Cairo'
            > COALESCE($2::timestamptz, now())
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
        // ADR-0061 §2 — نفس مصدر الحقيقة اللي الطلب القائم بيتقاس بيه: `$8` هي
        // `estimated_duration_days` الخام (ممكن NULL)، مش «عدد أيام» متحوّل لـ1.
        candidateLoad: {
          estimatedDurationDaysExpr: '$8::numeric',
          durationMinutesExpr: '$5::int',
          serviceDefaultMinutesExpr: 'NULL',
        },
      })}
      -- **ADR-0070 — فرع «منشغل جسديًا دلوقتي» اتشال من هنا كمان.**
      --
      -- ADR-0070 شال القاعدة دي من technicianAvailabilityCondition() وقال بالنص إنها «اتشالت
      -- بالكامل من الفرعين»، لكن نسخة التصنيف دي فضلت شايلاها — فرجع بالظبط الانحراف اللي
      -- ADR-0059 اتعمل عشان يمنعه: المحرك بيقول «مؤهّل» والتصنيف بيقول HEAVY على **نفس الفني
      -- ونفس الطلب**، فكل شاشة أدمن بتعرض القدرة كانت بتقول «محمّل» عن فني المطابقة بتعرض عليه
      -- شغل فعلًا. اتثبت بالتشغيل الحي (سيناريو A4).
      --
      -- الفني الشغّال دلوقتي بقى MEANINGFUL (عنده شغل تاني نفس اليوم تحت السقف) — وده أدق:
      -- بيقول للأدمن «عنده شغل» من غير ما يدّعي إنه مستبعد.
      --
      -- الـparameter بتاع ENGAGED بقى غير مستخدم في القاعدة، وبيفضل مربوط بتعبير دايمًا صحيح
      -- بنفس نمط activeOrderConflictExistsExpr — عشان Postgres يقدر يستنتج نوعه، ومن غير ما
      -- نعيد ترقيم باقي الـparameters.
      UNION ALL
      SELECT 1 WHERE $7::order_status[] IS NOT NULL AND FALSE
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
      params.candidateEstimatedDurationDays ?? null,
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
