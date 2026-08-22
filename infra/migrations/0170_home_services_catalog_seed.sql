-- baytak — 0170: بيانات أساسية لفئة "خدمات منزلية" (ADR-0031 Slice C) — فئة كتالوج عادية بالظبط
-- زي أي فئة تانية (سباكة، كهرباء)، الفني بيبقى مؤهّل لخدماتها بنفس آلية technician_services
-- العادية. الخدمات اللي بالساعة (جليسة أطفال، تنظيف بالساعة) requires_precise_schedule=true.
-- الأسعار تمثيلية بس — الأدمن يعدّلها فعليًا من apps/admin زي أي خدمة تانية.

INSERT INTO service_categories (name_ar, name_en, slug, description_ar, display_order, is_active, is_featured, launch_phase)
VALUES (
  'خدمات منزلية', 'Home Services', 'home-services',
  'جليسات أطفال، مربيات، تنظيف بالساعة أو الشهر — بنفس معايير اعتماد الفنيين العادية',
  0, true, true, 1
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO services (category_id, name_ar, name_en, slug, short_description_ar, pricing_model, base_price_cents, warranty_days, requires_photos, allows_scheduling, requires_precise_schedule, min_technician_level, commission_percentage, is_active, launch_phase)
SELECT sc.id, v.name_ar, v.name_en, v.slug, v.short_description_ar, 'hourly', v.base_price_cents, 0, false, true, v.requires_precise_schedule, 'new', 20, true, 1
FROM service_categories sc
CROSS JOIN (VALUES
  ('جليسة أطفال بالساعة', 'Babysitting (Hourly)', 'babysitting-hourly', 'جليسة أطفال معتمدة، بالساعة', 8000::integer, true),
  ('مربية', 'Nanny', 'nanny', 'مربية دائمة أو شبه دائمة لرعاية الأطفال', 8000::integer, true),
  ('تنظيف بالساعة', 'Cleaning (Hourly)', 'cleaning-hourly', 'تنظيف منزلي بالساعة', 6000::integer, true),
  ('تنظيف شهري / إقامة', 'Monthly Live-In Cleaning', 'cleaning-monthly-live-in', 'عاملة تنظيف مقيمة بعقد شهري', 500000::integer, false)
) AS v(name_ar, name_en, slug, short_description_ar, base_price_cents, requires_precise_schedule)
WHERE sc.slug = 'home-services'
ON CONFLICT (slug) DO NOTHING;
