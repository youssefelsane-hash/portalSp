-- عرض «الأكثر طلبًا» يحتاج هوية صغيرة مستقلة عن بانر/اسم صفحة الخدمة.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS featured_icon_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS featured_name_ar VARCHAR(60) NULL;

COMMENT ON COLUMN services.featured_icon_url IS
  'شعار صغير مستقل لكارت الخدمة في قسم الأكثر طلبًا؛ null يرجع إلى icon_url للتوافق';
COMMENT ON COLUMN services.featured_name_ar IS
  'اسم عربي خاطف لقسم الأكثر طلبًا؛ null يرجع إلى name_ar للتوافق';
