-- baytak — 0202: أنواع إشعار جديدة لصاحب الشكوى (docs/08 §73 بند 2، بلاغ مالك صريح 2026-08-27:
-- الأدمن يرد على شكوى، الرسالة توصل بس مفيش notification لصاحبها). كانوا كلهم للأدمن بس
-- (complaint_filed/support_chat_message_received) — الاتجاه العكسي (أدمن → صاحب الشكوى) صفر.

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels) VALUES
  ('complaint_reply', 'informational', '["push","in_app"]'::jsonb),
  ('complaint_resolved', 'informational', '["push","in_app"]'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;
