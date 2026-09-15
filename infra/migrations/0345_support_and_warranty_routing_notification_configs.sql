-- صفوف إعدادات ناقصة لنوعين إشعار موجودين في الكود (اتلقطوا بـ
-- `notification-type-config-coverage.spec.ts` — الاختبار اللي موجود عشان الحالة دي بالظبط).
--
-- **الضرر بلا الصفوف دي**: النوع اللي مالوش صف بيوصل `in_app` بس — يعني **مفيش push**،
-- ومفيش مقبض للأدمن يتحكم بيه من لوحة إعدادات أنواع الإشعارات. والاتنين دول موجّهين لفريق
-- داخلي (الدعم / الضمان)، فإشعار بلا push معناه عمليًا إن حد لازم يفضل فاتح اللوحة عشان
-- يشوف تذكرة جديدة أو مطالبة ضمان.
--
-- التصنيف مأخوذ من أقرب نظير موجود بالفعل: `support_chat_message_received` مسجّل
-- `action_required` + `["in_app","push"]`، ودول نفس الطبيعة — شغل واصل لفريق ومستني تصرّف.
-- `is_actionable = false` زي نظيره كمان: الإشعار بيوصّل لمكان الشغل، مش بيحمل أزرار قرار
-- جوّه الإشعار نفسه.
INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels, sound_key, is_actionable)
VALUES
  ('support_ticket_created', 'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('warranty_claim_opened',  'action_required', '["in_app","push"]'::jsonb, NULL, false)
ON CONFLICT (notification_type) DO NOTHING;
