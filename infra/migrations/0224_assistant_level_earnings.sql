-- 0224: أجر المساعد الأساسي يتدرّج حسب مستواه، مع snapshot محاسبي كامل وقت التسوية.
--
-- الفنيون يفضلون على نظام أوزان الطاقم الحالي. المساعد فقط يبدأ من الأجر اليومي المحفوظ في
-- service_standard_data وقت إنشاء الطلب، ثم يضرب في معامل مستواه. تغيير السياسة بعد التسوية
-- لا يعيد كتابة التاريخ المالي.

ALTER TABLE technician_level_config
  ADD COLUMN IF NOT EXISTS assistant_earning_multiplier numeric(5,2) NOT NULL DEFAULT 1.00
  CHECK (assistant_earning_multiplier > 0 AND assistant_earning_multiplier <= 3.00);

UPDATE technician_level_config SET assistant_earning_multiplier = 1.00 WHERE level = 'new';
UPDATE technician_level_config SET assistant_earning_multiplier = 1.10 WHERE level = 'verified';
UPDATE technician_level_config SET assistant_earning_multiplier = 1.25 WHERE level = 'professional';
UPDATE technician_level_config SET assistant_earning_multiplier = 1.45 WHERE level = 'premium';
UPDATE technician_level_config SET assistant_earning_multiplier = 1.60 WHERE level = 'team_leader';

COMMENT ON COLUMN technician_level_config.assistant_earning_multiplier IS
  'معامل أجر المساعد: 1.00 = أجر الخدمة الأساسي، 1.25 = زيادة 25%. لا يغيّر توزيع الفنيين.';

ALTER TABLE order_earning_shares
  ADD COLUMN IF NOT EXISTS calculation_method varchar(30) NOT NULL DEFAULT 'weighted_pool'
    CHECK (calculation_method IN ('weighted_pool', 'assistant_level_wage')),
  ADD COLUMN IF NOT EXISTS assistant_base_wage_cents integer NULL
    CHECK (assistant_base_wage_cents IS NULL OR assistant_base_wage_cents >= 0),
  ADD COLUMN IF NOT EXISTS assistant_level_multiplier numeric(5,2) NULL
    CHECK (assistant_level_multiplier IS NULL OR assistant_level_multiplier > 0),
  ADD COLUMN IF NOT EXISTS assistant_target_cents integer NULL
    CHECK (assistant_target_cents IS NULL OR assistant_target_cents >= 0);

COMMENT ON COLUMN order_earning_shares.calculation_method IS
  'weighted_pool = توزيع الأوزان المعتاد؛ assistant_level_wage = أجر المساعد الأساسي × معامل المستوى.';
COMMENT ON COLUMN order_earning_shares.assistant_base_wage_cents IS
  'Snapshot لأجر المساعد الأساسي عن كامل مدة الطلب قبل معامل المستوى.';
COMMENT ON COLUMN order_earning_shares.assistant_level_multiplier IS
  'Snapshot لمعامل مستوى المساعد وقت التسوية.';
COMMENT ON COLUMN order_earning_shares.assistant_target_cents IS
  'Snapshot للمستهدف المحسوب للمساعد قبل التحقق من كفاية وعاء المستحقات.';
