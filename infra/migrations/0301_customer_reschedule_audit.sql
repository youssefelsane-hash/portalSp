-- P2-4: customer reschedules need an auditable, concurrency-safe counter.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_reschedule_count integer NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_customer_reschedule_count_nonnegative
  CHECK (customer_reschedule_count >= 0);

INSERT INTO settings (key, value, value_type, group_name, description)
VALUES
  ('orders.customer_reschedule_max_count', '3'::jsonb, 'number', 'orders',
   'أقصى عدد مرات يغيّر فيها العميل موعد نفس الطلب بنفسه. صفر = بلا حد؛ بعد الحد يلزم تدخل الدعم، ولا تُنشأ رسوم تلقائية.')
ON CONFLICT (key) DO NOTHING;
