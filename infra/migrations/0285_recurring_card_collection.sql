-- نوبات الحجز المتكرر المدفوعة بالبطاقة تُنشأ قبل الموعد حتى يتسع وقت التحصيل، لكن لها
-- سياسة مستقلة: أول محاولة عند T-3 أيام، ثلاث محاولات كحد أقصى، ثم إلغاء قبل T-24 ساعة.
-- حفظ العداد وموعد المحاولة في الطلب نفسه يجعل الـsweep آمناً عبر أكثر من نسخة API.
ALTER TABLE orders
  ADD COLUMN recurring_payment_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (recurring_payment_attempt_count >= 0),
  ADD COLUMN recurring_payment_next_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN recurring_cash_reminder_sent_at TIMESTAMPTZ NULL;

CREATE INDEX idx_orders_recurring_card_collection
  ON orders (recurring_payment_next_attempt_at, scheduled_at)
  WHERE order_type = 'recurring'
    AND order_status = 'pending_payment'
    AND payment_method = 'card';

CREATE INDEX idx_orders_recurring_cash_reminder
  ON orders (scheduled_at)
  WHERE order_type = 'recurring'
    AND recurring_cash_reminder_sent_at IS NULL;

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels) VALUES
  ('recurring_card_payment_failed', 'action_required', '["push", "in_app"]'::jsonb),
  ('recurring_cash_reminder', 'informational', '["push", "in_app"]'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;
