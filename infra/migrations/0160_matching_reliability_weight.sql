-- baytak — 0160: وزن الموثوقية (rating) في محرك المطابقة (docs/08 §36.20-21، ADR-0023)
-- تدقيق حي أثبت إن 4 من 5 أوزان سياسة المطابقة المطلوبة (جودة/قدرة/عدالة/مسافة) موجودة وشغالة
-- فعليًا — الفجوة الوحيدة الحقيقية كانت الموثوقية (تقييم الفني مالوش أي أثر على ترتيبه في
-- findEligibleTechnicians()). افتراضي 0 = معطّل بالكامل (نفس فلسفة fairness_weight بالحرف —
-- تفعيل صريح مطلوب، صفر تغيير سلوك صامت على منصة شغالة).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.reliability_weight', '0', 'number', 'matching',
   'وزن تقييم الفني (average_rating) في ترتيب المطابقة — 0 = معطّل بالكامل (افتراضي)', false),
  ('matching.reliability_baseline_rating', '4.0', 'number', 'matching',
   'خط أساس التقييم المتوقّع — فني فوقه ياخد أولوية إضافية، تحته خصم (نسبة لـreliability_weight)', false),
  ('matching.reliability_min_ratings_count', '3', 'number', 'matching',
   'أقل عدد تقييمات مطلوب قبل ما الموثوقية تأثر على الترتيب — فني تحت العدد ده محايد تمامًا (صفر تأثير سلبي/إيجابي)', false)
ON CONFLICT (key) DO NOTHING;
