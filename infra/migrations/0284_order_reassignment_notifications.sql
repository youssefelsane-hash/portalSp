-- baytak — 0284: إبلاغ المنفّذ السابق صراحة عند نقل الطلب منه.
-- من غير هذا الصف كان المنفّذ الجديد فقط يعرف بالتعيين، بينما القديم قد يظل متجهًا للطلب.

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels) VALUES
  ('order_reassigned_away', 'high', '["push", "in_app"]'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;
