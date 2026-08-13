-- baytak — 0071: قاعدة توجيه افتراضية لإشعار الأدمن عند إلغاء فني لطلب اتقبله — نفس نمط
-- order.emergency_created (migration 0053) بالحرف. قابلة للتعديل/الحذف من /notification-routing-rules.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.technician_cancelled', 'ops_manager', '["in_app"]');
