-- حملات التسويق كانت تستخدم ثابت `CAMPAIGN_NOTIFICATION_TYPE` بدل كتابة النوع مباشرة داخل
-- `notify()`. لذلك فحص التغطية القديم لم يلتقطها، ولم يكن لها صف إعدادات؛ وغياب الصف يجعل
-- NotificationsService يحفظ الإشعار داخل التطبيق فقط من غير Push.
--
-- نضيف القناتين من غير حذف أي قناة سبق أن اختارها الأدمن في بيئة قائمة.
INSERT INTO notification_type_configs (
  notification_type,
  priority_tier,
  default_channels,
  sound_key,
  is_actionable
)
VALUES (
  'marketing_campaign',
  'informational',
  '["in_app","push"]'::jsonb,
  NULL,
  false
)
ON CONFLICT (notification_type) DO UPDATE
SET default_channels = (
      SELECT jsonb_agg(channel ORDER BY channel)
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(
          notification_type_configs.default_channels || EXCLUDED.default_channels
        ) AS channel
      ) AS channels
    ),
    updated_at = now();
