-- P1-1: these are visibility thresholds only. No scheduler may move money based on them.
INSERT INTO settings (key, value, value_type, group_name, description)
VALUES
  ('payments.stale_payment_hours', '24'::jsonb, 'number', 'payments',
   'بعد كام ساعة تظهر الدفعة pending أو processing أو manual_review في فحص التسوية للمراجعة البشرية. لا ينشئ النظام محاولة تحصيل بديلة تلقائيًا.'),
  ('payments.stale_refund_hours', '24'::jsonb, 'number', 'payments',
   'بعد كام ساعة يظهر الاسترداد العالق عند بوابة الدفع في فحص التسوية للمراجعة البشرية. لا يعيد النظام الاسترداد ولا يخرج أي أموال تلقائيًا.')
ON CONFLICT (key) DO NOTHING;
