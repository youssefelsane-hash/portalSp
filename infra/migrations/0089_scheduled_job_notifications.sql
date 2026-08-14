-- baytak — 0089: توصيل scheduled_job (تذكيرات ذكية للشغل المستقبلي المؤكَّد للفني) — ADR-0012،
-- docs/08 §15، متبقٍ صريح من Phase 1. الفني بيتنبه أول ما يقبل طلب بموعد مستقبلي (scheduled_at)،
-- بعدين تذكيرات مبنية على checkpoints (فورًا، +ساعة، صبح اليوم اللي قبله، قبل الموعد بفترة) —
-- مش تكرار ثابت زي action_required، وبتوقف بمجرد ما الفني يفتح الإشعار (acknowledged_at) مش
-- محتاجة "فعل" فعلي زي action_required.

-- الوقت المستهدف (موعد الطلب scheduled_at) — أساس حساب الـcheckpoints، غائب عن action_required
-- (اللي بيتكرر بفاصل ثابت من الإنشاء نفسه مش من تاريخ مستهدف).
ALTER TABLE notification_workflows ADD COLUMN target_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN notification_workflows.target_at IS 'الموعد المستهدف لـscheduled_job (orders.scheduled_at وقت الإنشاء) — checkpoints التذكير بتتحسب بالنسبة له، مش بفاصل ثابت زي action_required.';

-- النوع الجديد: الفني قبل طلب بموعد مستقبلي (مختلف عن order_assigned العادي — ده لطلبات ASAP لسه
-- زي ما هو، صفر تغيير سلوكي). requires_acknowledgment=true فعليًا (قابل للتعديل من الأدمن).
INSERT INTO notification_type_configs (notification_type, priority_tier, sound_key, requires_acknowledgment) VALUES
  ('order_assigned_scheduled', 'scheduled_job', 'scheduled_job_soft', true)
ON CONFLICT (notification_type) DO NOTHING;

-- إعدادات checkpoints — كل قيمة قابلة للتعديل من الأدمن، صفر hardcode.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('notification_engine.scheduled_job_reminder_after_minutes', '60', 'number', 'notification_engine', 'أول تذكير scheduled_job بعد كام دقيقة من القبول لو الفني لسه ما فتحش الإشعار الأول', false),
  ('notification_engine.scheduled_job_day_before_hour_utc',    '8',  'number', 'notification_engine', 'الساعة (UTC) صبح اليوم اللي قبل الموعد لتذكير scheduled_job — لو الموعد بعيد بما يكفي', false),
  ('notification_engine.scheduled_job_pre_appointment_minutes','120','number', 'notification_engine', 'قد إيه قبل الموعد نفسه يتبعت آخر تذكير scheduled_job', false)
ON CONFLICT (key) DO NOTHING;
