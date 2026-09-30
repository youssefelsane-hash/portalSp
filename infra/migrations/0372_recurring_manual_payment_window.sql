-- Osta — 0372: مهلة دفع حقيقية لنوبات الحجز المتكرر اليدوية (ADR-0116، docs/08 §189 بند D-1).
--
-- النوبة بتتولّد قبل موعدها بأيام، لكنها كانت بتتلغي بعد مهلة الطلب اللحظي (15 دقيقة). الميعاد
-- بيتحسب مرة واحدة وقت التوليد ويتخزن هنا، فاللي اتقال للعميل في الإشعار هو نفسه اللي بيتطبّق.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS recurring_payment_deadline_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN orders.recurring_payment_deadline_at IS
  'آخر ميعاد لدفع نوبة متكررة يدوية (InstaPay) قبل إلغائها تلقائيًا. NULL = مهلة orders.payment_timeout_minutes العادية. بيتحسب وقت التوليد (ADR-0116).';

INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'recurring.manual_payment_window_hours',
  '24'::jsonb,
  'number',
  'recurring',
  'مهلة دفع النوبة المتكررة اليدوية (InstaPay) بالساعات من وقت توليدها — بعدها النوبة دي بس بتتلغي والخطة تفضل شغّالة. محدودة دايمًا بـ24 ساعة قبل الموعد (ADR-0116).',
  false
)
ON CONFLICT (key) DO NOTHING;

-- تذكير الدفع بيمشي على محرك workflows الحالي (scheduled_job نسبةً للميعاد). فتح الإشعار مش دفع،
-- فـrequires_acknowledgment = false: التذكيرات بتقف بالدفع/التبليغ/الإلغاء بس.
INSERT INTO notification_type_configs
  (notification_type, priority_tier, default_channels, sound_key, is_actionable, requires_acknowledgment)
VALUES
  ('recurring_order_payment_reminder', 'scheduled_job', '["in_app","push"]'::jsonb, 'scheduled_job_soft', false, false)
ON CONFLICT (notification_type) DO NOTHING;
