-- baytak — 0154: وزن رفض الفرصة في نموذج العدالة (docs/08 §34.2، ADR-0020 §6)
-- عدد الفرص المرفوضة الحديثة بيتحسب "شبه شغل" لغرض العدالة بس بوزن أخف من الشغل الفعلي المؤكد
-- (منع فني من الحفاظ على أفضلية "مش شغال" مصطنعة برفض كل الفرص). افتراضي 0.5 — نص وزن الشغل
-- المؤكد. مفصولة عن matching.fairness_weight (migration 0153) اللي بيتحكم في تفعيل نموذج العدالة
-- كله (لسه افتراضيًا 0 = معطّل بالكامل).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.fairness_decline_weight', '0.5', 'number', 'matching',
   'وزن الفرصة المرفوضة الحديثة في حساب العدالة، نسبة لوزن الطلب المؤكد الفعلي (0 = الرفض بلا أثر، 1 = زي المؤكد بالظبط)', false)
ON CONFLICT (key) DO NOTHING;
