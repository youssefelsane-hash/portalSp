INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('recurring.materialization_lead_time_hours', '96', 'number', 'recurring',
   'عدد الساعات قبل موعد الحجز المتكرر التي يتحول فيها إلى طلب فعلي لبدء المطابقة والدفع مبكرًا', false),
  ('recurring.payment_reminder_hours', '[72,48,24]', 'json', 'recurring',
   'مواعيد تذكير العميل بالدفع قبل تنفيذ الطلب المتكرر، بالساعات', false)
ON CONFLICT (key) DO NOTHING;
