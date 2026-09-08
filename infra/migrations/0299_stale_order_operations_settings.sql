-- P1-3: long-running work and prolonged matching must become visible to operations,
-- while cancellation and any refund remain explicit manual actions.
INSERT INTO settings (key, value, value_type, group_name, description)
VALUES
  ('orders.stale_matching_hours', '24'::jsonb, 'number', 'limits',
   'بعد كام ساعة من البحث بلا عرض مطابقة حي يظهر الطلب في مركز العمليات للمراجعة اليدوية. إعادة المحاولة تستمر ولا يوجد إلغاء تلقائي.'),
  ('orders.stale_in_progress_hours', '48'::jsonb, 'number', 'limits',
   'بعد كام ساعة من بداية التنفيذ يظهر الطلب المتوقف في مركز العمليات للمراجعة اليدوية. لا يلغي النظام الطلب أو أي مدفوعات تلقائيًا.')
ON CONFLICT (key) DO NOTHING;
