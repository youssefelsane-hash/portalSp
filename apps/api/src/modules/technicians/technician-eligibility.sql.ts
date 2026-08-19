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
 *   الخدمة بالدقايق فوق حد `fullDayThresholdMinutesParam`).
 * - **طلب الطوارئ "إضافي" مش شاغل يوم كامل** (§9) — الفني اللي عنده طلب مجدول مقبول (accepted)
 *   بس لسه ما بدأش يتحرّك ليه، يقدر يستقبل طوارئ برضه. الاستبعاد للطوارئ بس لو الفني منشغل
 *   جسديًا فعليًا دلوقتي (`ENGAGED_TECHNICIAN_ORDER_STATUSES` — أضيق من الحالات النشطة العادية،
 *   بتستبعد `accepted` عمداً).
 * - **إصلاح توقيت حقيقي**: كل مقارنات اليوم/الساعة هنا بقت `AT TIME ZONE 'Africa/Cairo'` صراحة
 *   بدل الاعتماد على توقيت جلسة Postgres الافتراضي (UTC عادة) — قبل كده `(scheduled_at)::date`
 *   كان ممكن يرجّع اليوم الغلط (يوم قبل اللي العميل فعليًا قصده) لأي وقت بين نص الليل و2 الصبح
 *   بتوقيت مصر، ونفس المشكلة لمقارنة `start_time`/`end_time` (تخزين محلي) ضد وقت UTC خام.
 *
 * القاعدة الكاملة دلوقتي:
 *  1. طلب بلا موعد (ASAP أو طوارئ) — الطوارئ تتستبعد بس لو الفني *منشغل جسديًا فعليًا دلوقتي*
 *     (`ENGAGED_TECHNICIAN_ORDER_STATUSES`)؛ ASAP العادي (مش طوارئ) يتستبعد لو عنده أي طلب نشط
 *     بالمعنى الأوسع (`ACTIVE_TECHNICIAN_ORDER_STATUSES`، بما فيها `accepted`).
 *  2. طلب بموعد مستقبلي (دايمًا مجدول غير طوارئ — الطوارئ ميقدرش يكون عنده `scheduled_at` أصلاً،
 *     `orders.service.ts` بيرفضه صراحة) — استبعاد بس لو فيه طلب تاني بموعد **نفس اليوم بتوقيت
 *     مصر** والشغل ده (القديم أو الجديد) "شاغل يوم كامل".
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
  /** parameter لـ`matching.full_day_job_minutes` (إعداد قابل للتعديل، افتراضي 360) — ADR-0018 §2/§9. */
  fullDayThresholdMinutesParam: string;
  /**
   * ADR-0017 بند 10 — Fallback توسيع النطاق لما تنضب قايمة الفنيين "المثاليين". لو `true`، بيتجاهل
   * شروط (1) و(2) (تعارض الطلب النشط) تمامًا — الفني ممكن يترشّح حتى لو مشغول بطلب تاني — لكن
   * شرط (3) (استثناء `blocked` الصريح) وباقي شروط الأهلية الأساسية (خدمة/منطقة/اعتماد) بره
   * الدالة دي بتفضل سارية دايمًا. الهدف: زيادة فرصة توصيل الطلب مع الحفاظ على ملاءمة التخصص —
   * مش بث عشوائي لأي حد.
   */
  ignoreActiveOrderConflict?: boolean;
}): string {
  const {
    technicianIdExpr,
    scheduledAtParam,
    excludeOrderIdParam,
    activeStatusesParam,
    engagedStatusesParam,
    isEmergencyParam,
    serviceDurationExpr,
    fullDayThresholdMinutesParam,
    ignoreActiveOrderConflict,
  } = opts;
  const activeOrderConflictConditions = ignoreActiveOrderConflict
    ? // Postgres مايقدرش يستنتج نوع parameter من غير أي إشارة ليه في الاستعلام ("could not
      // determine data type") — تعبيرات دايمًا صحيحة (tautology) لكل الـparameters الجديدة كمان
      // (engagedStatusesParam/isEmergencyParam/fullDayThresholdMinutesParam) بلا أي تأثير فعلي.
      `AND (${activeStatusesParam}::order_status[] IS NULL OR ${activeStatusesParam}::order_status[] IS NOT NULL)
       AND (${engagedStatusesParam}::order_status[] IS NULL OR ${engagedStatusesParam}::order_status[] IS NOT NULL)
       AND (${isEmergencyParam}::boolean IS NULL OR ${isEmergencyParam}::boolean IS NOT NULL)
       AND (${fullDayThresholdMinutesParam}::int IS NULL OR ${fullDayThresholdMinutesParam}::int IS NOT NULL)`
    : `
    -- (1) بلا موعد (ASAP أو طوارئ): طوارئ تتستبعد بس لو الفني منشغل جسديًا فعليًا دلوقتي
    -- (ADR-0018 §9 — طلب مقبول لسه ما بدأش مش "شغل" لغرض الطوارئ). ASAP العادي (مش طوارئ)
    -- يفضل بنفس الصرامة القديمة (أي طلب نشط بالمعنى الأوسع بيستبعده).
    AND (
      ${scheduledAtParam}::timestamptz IS NOT NULL
      OR (
        ${isEmergencyParam}::boolean IS TRUE
        AND NOT EXISTS (
          SELECT 1 FROM orders bo
          WHERE bo.technician_id = ${technicianIdExpr} AND bo.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
            AND bo.order_status = ANY(${engagedStatusesParam}::order_status[]) AND bo.deleted_at IS NULL
        )
      )
      OR (
        ${isEmergencyParam}::boolean IS NOT TRUE
        AND NOT EXISTS (
          SELECT 1 FROM orders bo
          WHERE bo.technician_id = ${technicianIdExpr} AND bo.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
            AND bo.order_status = ANY(${activeStatusesParam}::order_status[]) AND bo.deleted_at IS NULL
        )
      )
    )
    -- (2) بموعد مستقبلي (دايمًا مجدول غير طوارئ — الطوارئ ميقدرش يكون عنده scheduled_at خالص):
    -- استبعاد بس لو فيه طلب تاني بموعد *نفس اليوم بتوقيت مصر* والشغل شاغل يوم كامل.
    AND (
      ${scheduledAtParam}::timestamptz IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM orders co
        JOIN services cs ON cs.id = co.service_id
        WHERE co.technician_id = ${technicianIdExpr} AND co.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
          AND co.order_status = ANY(${activeStatusesParam}::order_status[]) AND co.deleted_at IS NULL
          AND co.scheduled_at IS NOT NULL
          AND (co.scheduled_at AT TIME ZONE 'Africa/Cairo')::date
              = (${scheduledAtParam}::timestamptz AT TIME ZONE 'Africa/Cairo')::date
          AND (
            COALESCE(co.estimated_duration_days, 0) >= 1
            OR COALESCE(cs.estimated_duration_minutes, 60) >= ${fullDayThresholdMinutesParam}::int
            OR ${serviceDurationExpr} >= ${fullDayThresholdMinutesParam}::int
          )
      )
    )`;
  return `
    ${activeOrderConflictConditions}
    -- (3) استثناء صريح (blocked) — الفني حدد بنفسه إنه مش متاح وقت الطلب ده (ASAP/طوارئ = دلوقتي)،
    -- كله بتوقيت مصر الصحيح مش UTC الخام.
    AND NOT EXISTS (
      SELECT 1 FROM technician_schedule_slots tss
      WHERE tss.technician_id = ${technicianIdExpr} AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND tss.slot_date = (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::date
        AND tss.start_time < ((COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')
              + (${serviceDurationExpr} || ' minutes')::interval)::time
        AND tss.end_time > (COALESCE(${scheduledAtParam}::timestamptz, now()) AT TIME ZONE 'Africa/Cairo')::time
    )
  `;
}
