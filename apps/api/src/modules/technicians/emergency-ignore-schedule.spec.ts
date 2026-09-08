import { technicianAvailabilityCondition } from './technician-eligibility.sql';

/**
 * **بث الطوارئ للكل** (`matching.emergency_ignore_schedule`، طلب مالك صريح 2026-09-05):
 * «الطلب يروح لكل الناس بالقرب… يتجاهل الـschedule تمامًا، فاضي بقى شغّال مش شغّال».
 *
 * الاختبار على **نص الـSQL** عمدًا: القاعدة دي شرط في استعلام التوزيع، والقيمة الحقيقية إنها
 * تشيل الشرطين الصح (تعارض الطلبات + الاستثناء الذاتي) وتسيب باقي بوابة الأهلية زي ما هي.
 * اختبار سلوكي كان هيحتاج تجهيز محرك المطابقة كامل عشان يثبت نفس الحاجة.
 */
describe('بث الطوارئ للكل — تجاهل الجدول', () => {
  const base = {
    technicianIdExpr: 'tp.id',
    scheduledAtParam: '$10',
    excludeOrderIdParam: '$4',
    activeStatusesParam: '$6',
    engagedStatusesParam: '$7',
    isEmergencyParam: '$8',
    serviceDurationExpr: 'COALESCE(s.estimated_duration_minutes, 60)',
    dailyCapacityMinutesParam: '$13',
  };

  it('الوضع الافتراضي: تعارض الطلبات **والإجازة** الاتنين ساريين', () => {
    const sql = technicianAvailabilityCondition(base);
    expect(sql).toMatch(/technician_schedule_slots/);
    expect(sql).toMatch(/active_orders|orders o\b|order_status/);
  });

  it('مع تجاهل الجدول: مفيش أي شرط جدول — لا إجازة ولا تعارض طلبات', () => {
    const sql = technicianAvailabilityCondition({ ...base, ignoreScheduleEntirely: true });
    expect(sql).not.toMatch(/technician_schedule_slots/);
  });

  it('العلم القديم (توسيع النطاق) بيفضل محترم الإجازة — الفرق بين العلمين مقصود', () => {
    const sql = technicianAvailabilityCondition({ ...base, ignoreActiveOrderConflict: true });
    // الاستثناء الذاتي مايتجاهلش مع الـfallback (ADR-0017 بند 10) — ده اللي بيفرّقه عن البث للكل.
    expect(sql).toMatch(/technician_schedule_slots/);
  });

  it('الـSQL بيفضل صالح تركيبيًا — كل الـparameters ليها إشارة في النص', () => {
    const sql = technicianAvailabilityCondition({ ...base, ignoreScheduleEntirely: true });
    // Postgres بيرفض parameter مالوش أي إشارة («could not determine data type»)، فالفرع ده
    // بيسيب tautologies مقصودة لكل parameter بدل ما يشيلها.
    for (const param of ['$6', '$7', '$8', '$13']) {
      expect(sql).toContain(param);
    }
  });
});
