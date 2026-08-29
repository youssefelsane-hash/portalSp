-- baytak — 0218: تحديثات الأدمِن على مطالبة الضمان تصل إلى العميل كإشعار واحد.
-- قناة push وحدها كافية للمحاولة الخارجية ولظهور الصف داخل صندوق الإشعارات (راجع 0215).

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels) VALUES
  ('warranty_claim_under_review', 'informational', '["push"]'::jsonb),
  ('warranty_claim_inspection_scheduled', 'informational', '["push"]'::jsonb),
  ('warranty_claim_approved', 'informational', '["push"]'::jsonb),
  ('warranty_claim_rejected', 'informational', '["push"]'::jsonb),
  ('warranty_claim_repair_in_progress', 'informational', '["push"]'::jsonb),
  ('warranty_claim_resolved', 'informational', '["push"]'::jsonb),
  ('warranty_claim_closed', 'informational', '["push"]'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;
