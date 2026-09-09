-- 0311 — تصحيح نوع إعدادات عرض أول طلب من 'integer' لـ'number'
--
-- `SettingValueType` في الكود أربع قيم بس: number | boolean | string | json.
-- migration 0309 بذر تلات مفاتيح بـ`value_type = 'integer'` — وده **مش نوع موجود**، فـ
-- `SettingsService.assertValueMatchesType()` بيقارن `expected='integer'` بأي `typeof` وبيطلع
-- `false` دايمًا. النتيجة إن المفاتيح التلاتة (قيمة الخصم، الحد الأدنى، الصلاحية) **ظاهرة
-- للأدمن ومستحيل يعدّلها** — كل محاولة بترجع VAL_001. نفس فئة الخلل اللي `settings-registry`
-- اتكتب عشانها، واتلقطت بيه.
--
-- التصحيح بالأمام مش بتعديل 0309 (سياسة الـmigrations في CLAUDE.md).

UPDATE settings
SET value_type = 'number', updated_at = NOW()
WHERE key IN (
  'marketing.first_order_discount_cents',
  'marketing.first_order_min_order_cents',
  'marketing.first_order_validity_days'
)
  AND value_type = 'integer';
