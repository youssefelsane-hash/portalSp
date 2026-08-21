-- baytak — 0158: أهلية "قيادة مهمة اعتماد" منفصلة عن can_lead_team (docs/08 §38، طلب مالك صريح
-- 2026-08-21). can_lead_team (migration 0028) بيحكم قدرة الفني على إنشاء/امتلاك شركة فنيين
-- (technician_companies) — مفهوم إداري أثقل، افتراضيًا false لـprofessional. طلب المالك هنا مختلف:
-- مين يقدر يبقى قائد مهمة واحدة (طلب "اعتماد") لو اتوزّعت عليه/اختاره العميل — والمالك ذكر صراحة
-- إن professional المفروض يظهر ويترشّح في اعتماد، فاستخدام can_lead_team نفسه كان هيتعارض معاه.
ALTER TABLE technician_level_config
  ADD COLUMN eligible_for_team_booking BOOLEAN NOT NULL DEFAULT false;

UPDATE technician_level_config
SET eligible_for_team_booking = true
WHERE level IN ('professional', 'premium', 'team_leader');
