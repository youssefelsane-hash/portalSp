-- Osta — 0373: الالتزام بالمواعيد جوّه ترتيب المطابقة + وزن صغير للتقييم (docs/08 §189 بند D-2).
--
-- نفس مقياس «الالتزام بالمواعيد» اللي العميل بيشوفه (وصل خلال 15 دقيقة من الموعد)، وبنفس حد العيّنة
-- `matching.min_punctuality_sample` (تحته محايد). المقياس: فرق مستوى = 10 نقط، وطلب نشط = 2.

INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES
  ('matching.punctuality_weight', '5'::jsonb, 'number', 'matching',
   'وزن الالتزام بالمواعيد في ترتيب المطابقة: الفرق بين فني وصل في معاده دايمًا وفني ماوصلش في معاده أبدًا = الرقم ده بالنقط (فرق المستوى = 10). 0 = معطّل. فني عيّنته أقل من matching.min_punctuality_sample محايد.',
   false),
  ('matching.punctuality_baseline_percent', '85'::jsonb, 'number', 'matching',
   'نسبة الالتزام «الطبيعية» (٪): فني فوقها بياخد أولوية صغيرة، وتحتها خصم بنسبة matching.punctuality_weight.',
   false)
ON CONFLICT (key) DO NOTHING;

-- الوزن كان 0 (مقاس بلا أثر). بيتغيّر لـ2 **بس** لو لسه على القيمة القديمة ومحدش من الأدمن غيّره —
-- أي قيمة اختارها الأدمن بتفضل زي ما هي.
UPDATE settings s
   SET value = '2'::jsonb,
       description = 'وزن تقييم الفني (average_rating) في ترتيب المطابقة: (التقييم − خط الأساس) × الوزن. 2 = تأثير صغير (5 نجوم ⇒ +2، 3 نجوم ⇒ −2؛ فرق المستوى = 10). 0 = معطّل.'
 WHERE s.key = 'matching.reliability_weight'
   AND s.value = '0'::jsonb
   AND s.updated_by_user_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM audit_logs a
      WHERE a.entity_type = 'setting' AND a.entity_id = s.id AND a.action = 'setting.updated'
   );
