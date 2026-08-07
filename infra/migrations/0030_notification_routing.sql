-- baytak — 0030: توجيه الإشعارات الداخلية حسب الدور (نقطة 10) — أي حدث محتاج فعل إداري
-- (شكوى جديدة، صرف محتاج مراجعة، ...) بيوصل لكل أدمن عنده الدور المناسب، بدون أي تعديل كود.
-- منفصل تماماً عن users.notification (لو موجودة لاحقاً كتفضيلات شخصية) — ده سياسة عامة
-- بيحددها super_admin: "حدث X يوصل لدور Y عبر قنوات Z".

CREATE TABLE notification_routing_rules (
  id           UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_type   VARCHAR(80)   NOT NULL,
  role_name    VARCHAR(60)   NOT NULL REFERENCES roles(name),
  channels     JSONB         NOT NULL DEFAULT '["in_app"]',
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (event_type, role_name)
);
CREATE INDEX idx_notification_routing_rules_event_type ON notification_routing_rules(event_type) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notification_routing_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('complaint.filed', 'support_agent', '["in_app"]'),
  ('payout.requires_review', 'finance', '["in_app"]');
