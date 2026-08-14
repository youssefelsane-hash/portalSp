-- baytak — 0103: تتبّع فشل توليد الطلبات المتكررة + إشعار تصعيد (docs/08 §19 بند 20) — كانت
-- فجوة موثّقة صراحة: generateFromTemplate() كانت بتحرّك next_run_at قدّام دايمًا مهما كان سبب
-- الفشل (مؤقت زي انقطاع DB لحظي، أو دائم زي عنوان اتمسح) وتسجّل سطر log بس — القالب كان يقدر
-- يفشل للأبد بصمت من غير أي أثر غير سطور log بتتغرق وسط باقي اللوجات، وصفر تنبيه لحد.

ALTER TABLE recurring_order_templates
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMPTZ NULL;

-- نفس نمط order.emergency_dispatch_struggling بالحرف (migration 0098) — ops_manager افتراضيًا،
-- قابلة للتعديل/الحذف من /admin/notification-routing-rules.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('recurring_template.generation_failing', 'ops_manager', '["in_app"]')
ON CONFLICT DO NOTHING;
