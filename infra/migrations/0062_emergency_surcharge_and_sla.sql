-- baytak (صُنّاع) — 0062: تحسينات الطوارئ (docs/08 §8) — رسوم صريحة للعميل + SLA معلن
-- orders.surge_amount_cents كان عمود راكد من migration 0007 الأولى (معرّف بس معمول عليه أي
-- استخدام خالص) — بيتفعّل هنا كـ"رسوم الطوارئ الإضافية" اللي العميل بيشوفها صراحة قبل التأكيد
-- (مختلفة تمامًا عن commission.emergency_adjustment_percentage الموجودة من migration 0052،
-- اللي عمولة داخلية بين المنصة والفني مش رسوم على العميل). نفس فلسفة migration 0052 بالحرف:
-- مفيش رقم نهائي متفق عليه في المصدر الأصلي، القيم هنا افتراضية معقولة وقابلة للتعديل فوراً من
-- /settings في apps/admin، مش قرار نهائي.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('pricing.emergency_surcharge_percentage', '20', 'number', 'pricing', 'رسوم إضافية صريحة (نسبة مئوية) على السعر التقديري لطلبات "طوارئ" — بتتعرض للعميل قبل التأكيد (orders.surge_amount_cents)، قيمة افتراضية تجريبية مش نهائية', false),
  ('emergency.sla_minutes', '60', 'number', 'pricing', 'الوقت المعلن للعميل ("هيوصلك خلال X دقيقة") لطلبات الطوارئ — رقم معلن بس، مش ETA محسوب من مسار/زحمة فعلية، قيمة افتراضية تجريبية مش نهائية', false);
