-- §28 — فجوة رصد حقيقية: العميل بيدوس "حوّلت" (confirmInstaPayTransferByCustomer) وده كان بيتسجّل
-- في القاعدة بلا أي تنبيه فعلي لفريق Finance — نفس نمط payout.requires_review/chat.support_message_received.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('payment.instapay_transfer_reported', 'finance', '["in_app"]');
