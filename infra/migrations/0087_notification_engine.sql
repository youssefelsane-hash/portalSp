-- baytak — 0087: محرك إشعارات حقيقي (أولوية/تكرار مُدار من الباك-إند) — ADR-0012، docs/08 §15
-- Phase 1: الأساس العام (notification_type_configs + notification_workflows) + إعدادات
-- action_required. critical_offer/scheduled_job لسه مؤجّلين لمرحلة لاحقة (تفاصيل في ADR نفسه).

-- إعداد لكل notification_type — صفر hardcode للأولوية/الصوت/القناة الافتراضية في الكود.
CREATE TABLE notification_type_configs (
  id                       UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  notification_type        VARCHAR(60)   NOT NULL UNIQUE,
  priority_tier             VARCHAR(20)   NOT NULL DEFAULT 'informational'
                               CHECK (priority_tier IN ('critical_offer','action_required','scheduled_job','informational')),
  default_channels          JSONB         NOT NULL DEFAULT '["push","in_app"]',
  sound_key                  VARCHAR(60)   NULL,
  is_actionable              BOOLEAN       NOT NULL DEFAULT false,
  action_labels               JSONB         NULL,
  requires_acknowledgment    BOOLEAN       NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_type_configs IS 'إعداد أولوية/صوت/قناة/actionable لكل notification_type — مُدار بالكامل من الأدمن (ADR-0012)، مفيش تعديل من غير قرار صريح.';

-- كل notification_type الموجودة فعليًا في الكود دلوقتي — priority_tier=informational افتراضيًا
-- (قرار آمن متعمّد: مفيش نوع موجود يتحول تلقائيًا لسلوك تكرار/actionable جديد بدون قرار أدمن صريح).
INSERT INTO notification_type_configs (notification_type, priority_tier) VALUES
  ('welcome', 'informational'),
  ('order_created', 'informational'),
  ('order_accepted', 'informational'),
  ('order_technician_on_way', 'informational'),
  ('order_technician_arrived', 'informational'),
  ('order_in_progress', 'informational'),
  ('order_awaiting_quote_approval', 'informational'),
  ('order_work_completed', 'informational'),
  ('order_cancelled_by_customer', 'informational'),
  ('order_cancelled_by_admin', 'informational'),
  ('order_quote_decision', 'informational'),
  ('order_reassigned', 'informational'),
  ('technician_verification_approved', 'informational'),
  ('technician_verification_rejected', 'informational'),
  ('assistant_opportunity', 'informational'),
  ('assistant_personal_assigned', 'informational'),
  ('technician_cancellation_rematch', 'informational'),
  ('order_assistant_assigned_manually', 'informational'),
  ('rating_submitted', 'informational'),
  ('referral_reward_earned', 'informational'),
  -- النوع الجديد بتاع الـwiring الأول (Phase 1) — action_required فعليًا من البداية.
  ('order_quote_pending_approval', 'action_required')
ON CONFLICT (notification_type) DO NOTHING;

UPDATE notification_type_configs
SET priority_tier = 'action_required', requires_acknowledgment = false
WHERE notification_type = 'order_quote_pending_approval';

-- state machine عام لأي إشعار "محتاج فعل" أو "محتاج acknowledgment" — منفصل عن notifications
-- (سجل تسليم فعلي، صف لكل محاولة إرسال) عمدًا: الجدول ده بيمثّل "الحاجة المطلوب حلها" نفسها،
-- مش كل مرة اتبعت فيها رسالة بخصوصها.
CREATE TABLE notification_workflows (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID          NOT NULL REFERENCES users(id),
  notification_type VARCHAR(60)   NOT NULL,
  entity_type       VARCHAR(40)   NULL,
  entity_id         UUID          NULL,
  title_ar          VARCHAR(160)  NOT NULL,
  body_ar           TEXT          NOT NULL,
  deep_link         VARCHAR(255)  NULL,
  requires_action   BOOLEAN       NOT NULL DEFAULT true,
  action_type       VARCHAR(60)   NULL,
  acknowledged_at   TIMESTAMPTZ   NULL,
  resolved_at       TIMESTAMPTZ   NULL,
  next_reminder_at  TIMESTAMPTZ   NULL,
  reminder_count    INTEGER       NOT NULL DEFAULT 0,
  max_reminders     INTEGER       NULL,
  expires_at        TIMESTAMPTZ   NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- الفهرس اللي الـsweep الدوري (NotificationWorkflowReminderService) هيعتمد عليه أساسًا.
CREATE INDEX idx_notification_workflows_pending_reminders
  ON notification_workflows (next_reminder_at)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_notification_workflows_entity ON notification_workflows (entity_type, entity_id);
CREATE INDEX idx_notification_workflows_user_id ON notification_workflows (user_id, created_at DESC);

COMMENT ON TABLE notification_workflows IS 'state machine لإشعارات action_required/scheduled_job — تكرار مُدار بالكامل من الباك-إند (ADR-0012)، مش client-only.';
COMMENT ON COLUMN notification_workflows.resolved_at IS 'أول ما الفعل المطلوب يتم فعليًا. لو الصلاحية انتهت (expires_at) بدون حل، next_reminder_at بيتصفّر (يوقف التكرار) لكن resolved_at بيفضل NULL — تمييز منطقي بين "اتحل" و"خلصت صلاحيته".';

-- كل صف تسليم فعلي (الإرسال الأول + أي تذكير) بيتربط بالـworkflow اللي ولّده — يسمح بتتبّع
-- "كل مرة بعتنا للمستخدم ده بخصوص الحاجة دي" من جدول notifications الموجود من غير تكرار بيانات.
ALTER TABLE notifications ADD COLUMN workflow_id UUID NULL REFERENCES notification_workflows(id);
CREATE INDEX idx_notifications_workflow_id ON notifications(workflow_id) WHERE workflow_id IS NOT NULL;

-- إعدادات action_required (Phase 1 بس — scheduled_job/critical_offer محتاجين إعدادات منفصلة
-- وقت التنفيذ، مؤجّلين مع باقي §15 غير المنفّذ لسه).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('notification_engine.action_required_reminder_interval_minutes', '60',    'number', 'notification_engine', 'كل قد إيه يتكرر تذكير action_required لحد ما يتحل (بالدقايق)', false),
  ('notification_engine.action_required_max_reminders',              '24',    'number', 'notification_engine', 'أقصى عدد تذكيرات لأي action_required قبل ما يفضل ساكت (مش resolved)', false),
  ('notification_engine.quiet_hours_start',                          '"22:00"', 'string', 'notification_engine', 'بداية ساعات الهدوء (UTC، HH:MM) — تذكيرات action_required بتتأجل لبعدها', false),
  ('notification_engine.quiet_hours_end',                            '"08:00"', 'string', 'notification_engine', 'نهاية ساعات الهدوء (UTC، HH:MM)', false),
  ('notification_engine.critical_offer_bypasses_quiet_hours',        'true',  'boolean', 'notification_engine', 'هل عروض critical_offer بتتخطى ساعات الهدوء (لسه غير مفعّل الاستخدام في Phase 1)', false);
