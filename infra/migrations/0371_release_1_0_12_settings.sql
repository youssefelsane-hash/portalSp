-- إعدادات نسخة 1.0.12 (docs/08 §189). كل إعداد هنا بيقراه runtime فعلاً، ومسجّل في
-- apps/api/src/modules/settings/settings-registry.ts بنفس القيمة الافتراضية.

-- UX-2 / ADR-0115 — التوجيه التلقائي بين الدخول والتسجيل.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'auth.phone_status_lookup_enabled',
  'true'::jsonb,
  'boolean',
  'security',
  'التوجيه التلقائي بين الدخول والتسجيل (ADR-0115): الواجهة تسأل «الرقم ده مسجّل؟» وتنقل المستخدم. الإيقاف بيرجّع السلوك القديم (مفيش توجيه)، ومسار الدخول نفسه مابيتأثرش في الحالتين.',
  false
)
ON CONFLICT (key) DO NOTHING;
