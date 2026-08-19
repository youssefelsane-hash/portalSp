/**
 * شرط SQL موحّد لتوافر الفني وقت طلب معيّن — المصدر الوحيد المستخدم حرفيًا في الأماكن الثلاثة
 * اللي بتسأل نفس السؤال ("الفني ده يقدر ياخد الطلب ده فعليًا؟"): matching.service.ts (التوزيع
 * الفعلي)، technicians.service.ts (قايمة اختيار العميل اليدوي)، وtechnician-assignment-guard
 * .service.ts (تعيين الأدمن القسري). راجع ADR-0017 للتصميم الكامل والسبب.
 *
 * القاعدة (ADR-0017 بند 2-3-5): الفني متاح افتراضيًا (opt-out) — مفيش اعتماد على
 * is_available/is_on_duty خالص هنا. الاستبعاد بيحصل بس لو:
 *  1. طلب بلا موعد (ASAP) وعنده طلب تاني نشط بالفعل ("مشغول دلوقتي" بمعناها الحرفي).
 *  2. طلب بموعد مستقبلي وعنده طلب تاني *بموعد مستقبلي كمان* بنافذة زمنية بتتقاطع فعليًا —
 *     طلب ASAP نشط دلوقتي **مايمنعش** طلب مجدول ليوم/وقت تاني (طلب صريح من المالك،
 *     2026-08-19 — سيناريو "تسليك مواصير نص يوم").
 *  3. الفني حدد بنفسه استثناء `blocked` (يوم كامل أو ساعات مخصصة) بيتقاطع مع وقت الطلب —
 *     لطلب ASAP، "وقت الطلب" = دلوقتي (`now()`).
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
  /** تعبير SQL لمدة الخدمة المقدّرة بالدقايق للطلب المرشّح، مثلاً `COALESCE(s.estimated_duration_minutes, 60)`. */
  serviceDurationExpr: string;
  /**
   * ADR-0017 بند 10 — Fallback توسيع النطاق لما تنضب قايمة الفنيين "المثاليين". لو `true`، بيتجاهل
   * شروط (1) و(2) (تعارض الطلب النشط) تمامًا — الفني ممكن يترشّح حتى لو مشغول بطلب تاني — لكن
   * شرط (3) (استثناء `blocked` الصريح) وباقي شروط الأهلية الأساسية (خدمة/منطقة/اعتماد) بره
   * الدالة دي بتفضل سارية دايمًا. الهدف: زيادة فرصة توصيل الطلب مع الحفاظ على ملاءمة التخصص —
   * مش بث عشوائي لأي حد.
   */
  ignoreActiveOrderConflict?: boolean;
}): string {
  const { technicianIdExpr, scheduledAtParam, excludeOrderIdParam, activeStatusesParam, serviceDurationExpr, ignoreActiveOrderConflict } = opts;
  const activeOrderConflictConditions = ignoreActiveOrderConflict
    ? // Postgres مايقدرش يستنتج نوع parameter من غير أي إشارة ليه في الاستعلام ("could not
      // determine data type") — تعبير دايمًا صحيح (tautology) بيستخدم activeStatusesParam
      // بلا أي تأثير فعلي على النتيجة.
      `AND (${activeStatusesParam}::order_status[] IS NULL OR ${activeStatusesParam}::order_status[] IS NOT NULL)`
    : `
    -- (1) ASAP: استبعاد كامل لو عنده أي طلب نشط دلوقتي بالفعل (بلا اعتبار لموعد الطلب التاني).
    AND (
      ${scheduledAtParam}::timestamptz IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM orders bo
        WHERE bo.technician_id = ${technicianIdExpr} AND bo.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
          AND bo.order_status = ANY(${activeStatusesParam}::order_status[]) AND bo.deleted_at IS NULL
      )
    )
    -- (2) مجدول: استبعاد بس لو فيه طلب تاني *بموعد مستقبلي كمان* بيتقاطع زمنيًا فعليًا.
    AND (
      ${scheduledAtParam}::timestamptz IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM orders co
        JOIN services cs ON cs.id = co.service_id
        WHERE co.technician_id = ${technicianIdExpr} AND co.id IS DISTINCT FROM ${excludeOrderIdParam}::uuid
          AND co.order_status = ANY(${activeStatusesParam}::order_status[]) AND co.deleted_at IS NULL
          AND co.scheduled_at IS NOT NULL
          AND tstzrange(co.scheduled_at, co.scheduled_at + (COALESCE(cs.estimated_duration_minutes, 60) || ' minutes')::interval)
              && tstzrange(
                   ${scheduledAtParam}::timestamptz,
                   ${scheduledAtParam}::timestamptz + (${serviceDurationExpr} || ' minutes')::interval
                 )
      )
    )`;
  return `
    ${activeOrderConflictConditions}
    -- (3) استثناء صريح (blocked) — الفني حدد بنفسه إنه مش متاح وقت الطلب ده (ASAP = دلوقتي).
    AND NOT EXISTS (
      SELECT 1 FROM technician_schedule_slots tss
      WHERE tss.technician_id = ${technicianIdExpr} AND tss.status = 'blocked' AND tss.deleted_at IS NULL
        AND tss.slot_date = (COALESCE(${scheduledAtParam}::timestamptz, now()))::date
        AND tss.start_time < ((COALESCE(${scheduledAtParam}::timestamptz, now()) + (${serviceDurationExpr} || ' minutes')::interval))::time
        AND tss.end_time > (COALESCE(${scheduledAtParam}::timestamptz, now()))::time
    )
  `;
}
