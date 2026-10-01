-- Osta — 0374: مواعيد في خطر داخل مركز الاستثناءات + تنبيه للعمليات مرة لكل مستوى
-- (docs/08 §189 بند D-4). مفيش خدمة مراقبة جديدة ولا إعادة مطابقة تلقائية: الموظف بيتصرف
-- بالأدوات الموجودة (reassign/rematch/reschedule).

INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES
  ('operations.departure_warning_minutes', '30'::jsonb, 'number', 'orders',
   'قبل الموعد بالمدة دي (دقايق) والفني لسه ماتحرّكش ⇒ «تحت المراقبة» (بلا تنبيه). ولو جه الموعد وهو لسه ماتحرّكش ⇒ «تأخر في التحرك» (أصفر) وتنبيه للعمليات.',
   false),
  ('operations.arrival_grace_minutes', '20'::jsonb, 'number', 'orders',
   'بعد الموعد بالمدة دي (دقايق) والفني لسه ماوصلش ⇒ «تأخر في الوصول» (أحمر) وتنبيه للعمليات.',
   false)
ON CONFLICT (key) DO NOTHING;

-- آخر مستوى اتبعت عنه تنبيه — compare-and-set بيضمن تنبيه واحد لكل مستوى (مش كل دقيقة)، والتصعيد
-- من أصفر لأحمر بيطلع تنبيه تاني مرة واحدة.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS at_risk_alert_level VARCHAR(20) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS at_risk_alerted_at TIMESTAMPTZ NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_at_risk_alert_level') THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_at_risk_alert_level
      CHECK (at_risk_alert_level IS NULL OR at_risk_alert_level IN ('late_departure', 'late_arrival'));
  END IF;
END $$;
COMMENT ON COLUMN orders.at_risk_alert_level IS
  'آخر مستوى خطر اتبعت عنه تنبيه للعمليات (late_departure أصفر / late_arrival أحمر) — docs/08 §189 D-4.';

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels, sound_key, is_actionable)
VALUES ('order_appointment_at_risk', 'action_required', '["in_app","push"]'::jsonb, NULL, false)
ON CONFLICT (notification_type) DO NOTHING;

INSERT INTO notification_routing_rules (event_type, role_name, channels)
VALUES ('order.appointment_at_risk', 'ops_manager', '["in_app","push"]')
ON CONFLICT (event_type, role_name) DO NOTHING;
