-- baytak — 0246: المسافة وزن حقيقي في ترتيب المطابقة، وشدّتها حسب سياق الطلب (ADR-0062).
--
-- قبل كده كانت المسافة كاسر تعادل بس (ORDER BY rank_score DESC, distance_km ASC): أي فرق في
-- rank_score مهما كان صغير بيتغلّب على أي فرق في المسافة مهما كان كبير. طلب المالك الصريح إن
-- القرب يبقى **أولوية حقيقية** في الطوارئ، والشغل خلال 48 ساعة، والشغل الرخيص — وإن الشدّة دي
-- تكون من عند الأدمن مش ثابتة في الكود.
--
-- كل الأوزان **صفر افتراضيًا** = السلوك القديم بالحرف. نفس فلسفة fairness_weight و
-- reliability_weight: تفعيل صريح مطلوب، صفر تغيير سلوك صامت على منصة شغالة.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.distance_weight', '0', 'number', 'matching',
   'وزن المسافة الأساسي في ترتيب المطابقة — كل كيلومتر بيخصم القيمة دي من نتيجة الفني. 0 = المسافة كاسر تعادل بس (افتراضي)', false),
  ('matching.distance_weight_emergency', '0', 'number', 'matching',
   'وزن المسافة لطلبات الطوارئ — القيمة كلها في وقت الوصول، فالقرب بياخد شدّة أعلى. لو أقل من الأساسي، الأساسي بيسري', false),
  ('matching.distance_weight_near_term', '0', 'number', 'matching',
   'وزن المسافة للطلبات خلال نافذة matching.near_term_request_hours (48 ساعة افتراضيًا) — مفيش مساحة لإعادة توزيع، فالأقرب أضمن', false),
  ('matching.distance_weight_low_value', '0', 'number', 'matching',
   'وزن المسافة للشغلانات الرخيصة (أقل من أو يساوي matching.low_value_order_cents) — تكلفة الانتقال بتاكل هامش الشغلانة', false),
  ('matching.low_value_order_cents', '15000', 'number', 'matching',
   'حد «الشغلانة الرخيصة» بالقرش (15000 = 150 جنيه) — الطلب تحته بياخد وزن المسافة المخصّص للشغل الرخيص', false)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE settings IS
  'إعدادات المنصة الحية. مجموعة matching بتتعرض في قسم مخصّص في شاشة إعدادات الأدمن (ADR-0062 §4)، مش في الجدول العام.';
