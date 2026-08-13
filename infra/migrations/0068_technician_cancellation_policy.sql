-- baytak — 0068: سياسة إلغاء الفني القابلة للإعداد (ADR-0006)
-- كانت hardcoded بالكامل (سبب اختياري + رسوم بس، مفيش نافذة زمنية، مفيش سلوك استرجاع حسب
-- booking_mode). الإعدادات هنا قابلة للتعديل فورًا من /settings بلا كود جديد، نفس نمط 0011/0050.

ALTER TYPE order_status ADD VALUE 'needs_technician_reselection';

ALTER TABLE cancellation_reasons ADD COLUMN requires_free_text BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN cancellation_reasons.requires_free_text IS 'لو true، النص الحر (reason) بقى إجباري مع السبب ده — مثلاً سبب "أخرى".';

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('technician_cancellation.self_cancel_enabled',              'true', 'boolean', 'technician_cancellation', 'مفتاح إيقاف عام لإلغاء الفني الذاتي بالكامل', false),
  ('technician_cancellation.window_minutes_after_acceptance',  '15',   'number',  'technician_cancellation', 'الإلغاء الذاتي مسموح بس خلال كذا دقيقة من وقت القبول — 0 يعني بلا حد زمني', false),
  ('technician_cancellation.min_minutes_before_scheduled_start','60',  'number',  'technician_cancellation', 'ممنوع الإلغاء لو باقي أقل من كذا دقيقة على الموعد المجدول', false),
  ('technician_cancellation.auto_rematch_individual',          'true', 'boolean', 'technician_cancellation', 'طلبات فرد/طوارئ بعد إلغاء الفني ترجع تلقائيًا للمطابقة', false),
  ('technician_cancellation.auto_rematch_team_assigned',       'false','boolean', 'technician_cancellation', 'لو false، طلبات "اعتماد"/تعيين يدوي من الإدارة بعد إلغاء الفني تحتاج العميل يعيد الاختيار بنفسه بدل إعادة مطابقة صامتة', false);
