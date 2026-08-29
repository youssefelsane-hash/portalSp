-- baytak — 0219: نتيجة الاسترداد المالي تصل إلى العميل بعد تثبيتها فعليًا فقط.

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels) VALUES
  ('refund_completed', 'informational', '["push"]'::jsonb),
  ('refund_rejected', 'informational', '["push"]'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;
