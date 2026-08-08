-- baytak — 0036: توجيه أحداث حساسة إضافية (نقطة 10 تكملة) — كانت فجوة موثّقة صراحة في
-- apps/api/src/modules/notifications/README.md: "باقي الأحداث الحساسة (تحصيل كاش، صرف اكتمل،
-- تقييم منخفض، ...) لسه بتوصل لصاحب العملية بس". نفس آلية 0030 بالظبط، أحداث جديدة بس.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('payment.cash_collected', 'finance', '["in_app"]'),
  ('payout.completed', 'super_admin', '["in_app"]'),
  ('rating.low_rating_submitted', 'support_agent', '["in_app"]');
