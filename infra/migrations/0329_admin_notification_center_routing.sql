-- مركز إشعارات الإدارة: أحداث لا ينبغي أن تتطلب من الأدمن زيارة كل شاشة يدويًا.
-- super_admin يُضم تلقائيًا في NotificationRoutingService لكل قاعدة موجهة.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('support_ticket.created', 'support_agent', '["in_app"]'::jsonb),
  ('warranty_claim.opened', 'finance', '["in_app"]'::jsonb)
ON CONFLICT (event_type, role_name) DO NOTHING;
