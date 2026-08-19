-- baytak — 0142: قاعدة توجيه إشعار "مفيش فني اتلاقاله" (قرار المالك 2026-08-19، §26.2/§19 بند 3
-- الملحق) — order.no_technician_found. نفس نمط order.emergency_dispatch_struggling بالحرف
-- (migration 0098)، بس لـops_manager وsupport_agent (call center) الاتنين معًا — المالك قال صراحة
-- "الإلغاء ده يكون فقط من خلال حد من admin أو من call center"، فالاتنين لازم يشوفوا الإشعار.

INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.no_technician_found', 'ops_manager', '["in_app"]'),
  ('order.no_technician_found', 'support_agent', '["in_app"]')
ON CONFLICT DO NOTHING;
