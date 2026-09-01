-- ADR-0050 §4 — فترة التعاقد المتفق عليها (اشتراك/إيجار)، مصدر عدد شهور الفوترة لخدمة
-- pricing_model=monthly. **مش** موعد الزيارة (scheduled_at/scheduled_end_at) — اشتراك 3 شهور
-- ممكن يتنفّذ بزيارة واحدة، فخلط الاتنين كان بيسعّر مدة الزيارة بدل مدة الاتفاق.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pricing_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS pricing_period_end timestamptz;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_pricing_period_order;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_pricing_period_order
  CHECK (
    pricing_period_start IS NULL
    OR pricing_period_end IS NULL
    OR pricing_period_end > pricing_period_start
  );

COMMENT ON COLUMN orders.pricing_period_start IS 'ADR-0050 §4 — بداية فترة التعاقد (اشتراك/إيجار)، مش موعد الزيارة';
COMMENT ON COLUMN orders.pricing_period_end IS 'ADR-0050 §4 — نهاية فترة التعاقد (اشتراك/إيجار)، مش موعد الزيارة';
