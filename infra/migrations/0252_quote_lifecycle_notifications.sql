-- ADR-0067 — إشعارات دورة حياة التقييم وعرض السعر.

-- قواعد توجيه للأدمن على الحدثين اللي محتاجين تدخّل إداري. نفس نمط 0238.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.quote_above_range_submitted', 'ops_manager', '["in_app"]'),
  ('order.quote_expired', 'ops_manager', '["in_app"]')
ON CONFLICT (event_type, role_name) DO NOTHING;

-- كاسح انتهاء الصلاحية (ADR-0067 §2) بيستعلم بـ(status, valid_until) كل دقيقة. الفهرس الموجود
-- `idx_order_quotes_admin_queue` على (status, created_at) مش بيخدم الترتيب ده، وكمان بيشمل
-- pending_admin_review اللي الكاسح بيستثنيه عمدًا (مهلة العميل بتبدأ بعد اعتماد الأدمن).
CREATE INDEX IF NOT EXISTS idx_order_quotes_expiry_sweep
  ON order_quotes(valid_until)
  WHERE status = 'pending_customer';
