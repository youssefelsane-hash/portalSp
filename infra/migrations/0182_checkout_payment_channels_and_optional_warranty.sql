-- Make every customer checkout channel explicitly controllable, and persist the
-- immutable optional-warranty selection that contributed to the order total.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.card_enabled', 'true', 'boolean', 'payments', 'إظهار الدفع بالبطاقة عبر Paymob للعملاء عند اكتمال الإعداد', false),
  ('payments.wallet_enabled', 'true', 'boolean', 'payments', 'إتاحة الدفع من محفظة العميل', false),
  ('payments.instapay_enabled', 'true', 'boolean', 'payments', 'إظهار InstaPay للعملاء عند اكتمال بيانات المستلم', false),
  ('payments.installments_enabled', 'true', 'boolean', 'payments', 'إتاحة خطط التقسيط المرتبطة بالخدمات عند جاهزية Paymob', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN warranty_plan_id UUID NULL REFERENCES warranty_plans(id),
  ADD COLUMN warranty_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (warranty_price_cents >= 0),
  ADD COLUMN warranty_plan_snapshot JSONB NULL;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_optional_warranty_snapshot
  CHECK (
    (warranty_plan_id IS NULL AND warranty_price_cents = 0 AND warranty_plan_snapshot IS NULL)
    OR
    (warranty_plan_id IS NOT NULL AND warranty_plan_snapshot IS NOT NULL)
  );

CREATE INDEX idx_orders_warranty_plan ON orders(warranty_plan_id) WHERE warranty_plan_id IS NOT NULL;
