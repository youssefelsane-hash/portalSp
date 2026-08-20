-- baytak — 0156: تصعيد نقص طاقم قبل الموعد المجدول (docs/08 §35.5، ADR-0021) —
-- CrewShortageEscalationService (apps/api/src/modules/orders/crew-shortage-escalation.service.ts).

-- علامة "اتصعّد مرة" — تمنع sweep من إعادة تصعيد نفس الطلب كل دقيقة. NULL يعني لسه ما اتصعّدش
-- (أو الطاقم اكتمل قبل ما يوصل للعتبة أصلاً — مش هيتصعّد خالص في الحالة دي).
ALTER TABLE orders ADD COLUMN crew_shortage_escalated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN orders.crew_shortage_escalated_at IS
  'وقت تصعيد نقص الطاقم للأدمن (مرة واحدة بس لكل طلب) — docs/08 §35.5. NULL = لسه ما اتصعّدش.';

-- فهرس جزئي — الـsweep بيدوّر بس على الصفوف اللي لسه NULL (نفس نمط فهارس PENDING_PAYMENT/
-- notification_workflows الجزئية الموجودة).
CREATE INDEX idx_orders_crew_shortage_pending ON orders (scheduled_at)
  WHERE crew_shortage_escalated_at IS NULL AND booking_mode = 'team';

-- عتبة التصعيد بالساعات قبل الموعد — قابلة للتعديل الكامل من `/settings` (SettingsService)،
-- نفس نمط orders.payment_timeout_minutes/notification_engine.* الموجودة.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('orders.crew_shortage_escalation_hours_before', '24', 'number', 'orders',
   'قد إيه قبل موعد طلب الفريق (بالساعات) نصعّد للأدمن لو الطاقم لسه ناقص', false)
ON CONFLICT DO NOTHING;

-- توجيه الإشعار — نفس نمط order.no_technician_found (migration 0142) بالحرف: ops_manager هو
-- المسؤول التشغيلي اليومي عن نقص الطاقم (نفس صلاحية orders.manage_crew، migration 0132).
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.crew_shortage_escalated', 'ops_manager', '["in_app"]')
ON CONFLICT DO NOTHING;
