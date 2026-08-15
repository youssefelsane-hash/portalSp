-- §24 تدقيق الاكتمال الداخلي — فجوة حقيقية موثّقة: صفر إشعار لأدمن لما عميل يبعت رسالة في شات
-- الدعم العام (support_chat) — أدمن مش متابع /support-chat مباشر كان عنده صفر إشارة إن عميل
-- بينتظر رد، بعكس complaint.filed/payout.requires_review اللي عندهم توجيه بالفعل.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('chat.support_message_received', 'support_agent', '["in_app"]');
