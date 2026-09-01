-- 0225: تثبيت أجر المساعد على الطلب وقت الحجز.
-- تعديل بيانات الخدمة لاحقًا يجب ألا يغيّر مستحقات طلب قائم بالفعل.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assistant_daily_wage_cents_snapshot integer NULL
  CHECK (assistant_daily_wage_cents_snapshot IS NULL OR assistant_daily_wage_cents_snapshot >= 0);

COMMENT ON COLUMN orders.assistant_daily_wage_cents_snapshot IS
  'Snapshot داخلي لأجر المساعد اليومي من service_standard_data وقت إنشاء الطلب.';
