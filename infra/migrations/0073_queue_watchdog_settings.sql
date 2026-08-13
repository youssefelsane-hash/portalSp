-- baytak — 0073: إعدادات watchdog الطوابير (BullMQ) — الجزء الأول من خطة "supervisor/health-check/
-- restart" لإغلاق فجوة "الـWorker مبيرجّعش يعالج وظايف بعد انقطاع Redis طويل" الموثّقة صراحة في
-- apps/api/src/modules/technicians/README.md (مطابقة لـ BullMQ issue #4479). الكود نفسه في
-- apps/api/src/modules/ops/queue-watchdog.service.ts — الجزء التاني (إعادة التشغيل الفعلية) في
-- infra/systemd/baytak-api.service.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('ops.queue_watchdog_enabled', 'true', 'boolean', 'ops', 'تفعيل/تعطيل مراقبة تعليق طوابير BullMQ (matching-rounds/customer-stats/technician-stats) — لو اتعطّل، مفيش exit تلقائي للـprocess حتى لو طابور معلّق', false),
  ('ops.queue_watchdog_check_interval_minutes', '2', 'number', 'ops', 'كل قد إيه (بالدقايق) الـwatchdog بيفحص الطوابير', false),
  ('ops.queue_watchdog_stall_threshold_minutes', '5', 'number', 'ops', 'أقل عدد دقايق تفضل فيها أقدم وظيفة واقفة في الطابور (مع إن Redis نفسه متاح ومتجاوَب) قبل ما نعتبرها Worker معلّق ونعمل exit نظيف للـprocess', false);
