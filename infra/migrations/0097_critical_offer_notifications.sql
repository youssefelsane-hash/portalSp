-- baytak — 0097: عرض طلب actionable + دورة تذكير critical_offer (docs/08 §17.16، ADR-0012 كان
-- أجّل بناء دورة التذكير دي صراحة). notification_type_configs جديدة + إعداد نِسَب checkpoints.

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels, sound_key, is_actionable, action_labels, requires_acknowledgment) VALUES
  ('order_offer', 'action_required', '["push","in_app"]'::jsonb, 'order_offer_alert', true, '{"accept":"قبول","reject":"رفض"}'::jsonb, false),
  ('order_offer_emergency', 'critical_offer', '["push","in_app"]'::jsonb, 'critical_offer_alert', true, '{"accept":"قبول","reject":"رفض"}'::jsonb, false),
  ('order_offer_lost', 'informational', '["in_app"]'::jsonb, null, false, null, false)
ON CONFLICT (notification_type) DO NOTHING;

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  (
    'notification_engine.critical_offer_reminder_ratios',
    '[0.5, 0.85]'::jsonb,
    'json',
    'notification_engine',
    'نِسَب مواقع تذكيرات عرض الطوارئ (critical_offer) جوّه نافذة الصلاحية نفسها (0-1، مثلاً 0.5 = نص المهلة) — قابلة للتعديل الكامل، صفر قيم دائمة',
    false
  )
ON CONFLICT (key) DO NOTHING;
