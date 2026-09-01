INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.photo_quote_requested', 'ops_manager', '["in_app"]'),
  ('order.photo_quote_accepted', 'ops_manager', '["in_app"]')
ON CONFLICT (event_type, role_name) DO NOTHING;
