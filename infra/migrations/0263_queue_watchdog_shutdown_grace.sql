-- تدقيق C-1/S-2 — الـwatchdog بقى يعمل إغلاق رشيق (SIGTERM) بدل `process.exit(1)` خام، ومحتاج
-- مهلة قابلة للضبط قبل الخروج القسري لو الإغلاق نفسه علّق.
--
-- القيمة الافتراضية ١٠ ثواني: أقل من `TimeoutStopSec=30` في
-- `infra/systemd/baytak-api.service` عمدًا — لازم شبكة الأمان بتاعتنا تسبق سكين systemd، مش
-- العكس، وإلا الخروج القسري بتاعنا مايتنفّذش أصلاً.
--
-- **القاعدة اللي بيطبّقها الصف ده**: أي مفتاح إعدادات بيتقرا من الكود لازم يكون له صف هنا
-- (تدقيق C-3/D-2) — مفتاح بيتقرا ومالوش صف = الأدمن مش قادر يضبطه أبدًا، ومفتاح له صف ومحدش
-- بيقراه = الأدمن بيعدّله ومفيش حاجة بتحصل. الاتنين بيتقفلوا في نفس السجل.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'ops.queue_watchdog_shutdown_grace_seconds',
  '10'::jsonb,
  'number',
  'ops',
  'مهلة الإغلاق الرشيق بالثواني قبل الخروج القسري لما الـwatchdog يكتشف طابور توزيع معلّق (لازم تفضل أقل من TimeoutStopSec في systemd)',
  false
)
ON CONFLICT (key) DO NOTHING;
