-- تدقيق docs/29 P0-3: التاريخ الماضي لا يتحول لطوارئ، والحجز المستقبلي له أفق واضح قابل للضبط.
INSERT INTO settings (key, value, value_type, group_name, description)
VALUES (
  'orders.max_advance_booking_days',
  '90'::jsonb,
  'number',
  'orders',
  'أقصى عدد أيام مسموح بحجزها مقدمًا من تاريخ اليوم بتوقيت القاهرة. صفر = حجز نفس اليوم فقط.'
)
ON CONFLICT (key) DO NOTHING;
