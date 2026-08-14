-- baytak — 0100: إعداد مهلة إلغاء PENDING_PAYMENT (docs/08 §19 بند 3+5، تدقيق جاهزية الإطلاق)
-- OrderAutoCancelService بقى بيعمل sweep دوري لطلبات PENDING_PAYMENT قديمة (العميل بدأ دفع
-- إلكتروني مسبق — كارت/InstaPay، ADR-0013 "PAY BEFORE DISPATCH" — بس مخلّصش الدفع) ويلغيها
-- تلقائيًا بعد المهلة دي. قيمة افتراضية 15 دقيقة (أقصر من orders.auto_cancel_after_minutes
-- عمدًا — مفيش داعي الطلب يحجز نافذة توزيع فني وهو أصلاً مدفوعش لسه).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('orders.payment_timeout_minutes', '15', 'number', 'limits', 'إلغاء تلقائي لطلب PENDING_PAYMENT لو الدفع ماتمش', false);
