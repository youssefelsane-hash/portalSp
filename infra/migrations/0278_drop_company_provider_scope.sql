-- ADR-0080 يستبدل ADR-0079 — **بقرار مالك صريح بعد مراجعة النموذج** (2026-09-06، نفس اليوم).
--
-- ADR-0079 أدّى للشركة نطاق تشغيل خاص (خدمات/فئات/مناطق على مستوى الشركة). المالك راجع
-- النموذج ورفضه بحُجّة تشغيلية صحيحة تمامًا:
--
--   «الشركة دي ممكن يكون عندها نجارين، عندها بوابين، عندها حدادين، عندها فئات كتير. فمش
--    منطقي إن أنا هدي للشركة كل الفئات اللي هم عندها — ما كده ممكن شغل البواب يروح للحداد.»
--
-- نطاق على مستوى الشركة = **اتحاد** تخصصات أعضائها، والتوزيع جوّه الشركة كان هيبقى مسموح له
-- يوصل لأي عضو في أي فئة من الاتحاد ده. النموذج الصح (ADR-0080): الشركة **مظلّة** لأعضاء
-- عاديين تمامًا، وكل عضو له نطاقه هو (منطقته وفئاته) زي أي فني مستقل بالظبط. اختيار العميل
-- للشركة بيشغّل توزيع تلقائي **جوّه** الشركة، محكوم بنطاق **كل عضو** — فشغل البواب مستحيل
-- يوصل للحداد.
--
-- الأعمدة اللي 0277 ضافها بقت بلا معنى، فبتتشال بالكامل بدل ما تفضل مخطط ميت. مفيش أي بيانات
-- إنتاجية فيها: 0277 اتعمل واتشال في نفس اليوم، وكل صفوف الشركة (لو وُجدت) نطاق مرفوض أصلاً.

DELETE FROM technician_services WHERE company_id IS NOT NULL;
DELETE FROM technician_categories WHERE company_id IS NOT NULL;
DELETE FROM technician_zones WHERE company_id IS NOT NULL;

ALTER TABLE technician_services DROP CONSTRAINT chk_technician_services_owner;
ALTER TABLE technician_categories DROP CONSTRAINT chk_technician_categories_owner;
ALTER TABLE technician_zones DROP CONSTRAINT chk_technician_zones_owner;

DROP INDEX idx_technician_services_company_id;
DROP INDEX idx_technician_categories_company_id;
DROP INDEX idx_technician_zones_company_id;
DROP INDEX uq_technician_services_company;
DROP INDEX uq_technician_categories_company;
DROP INDEX uq_technician_zones_company;

ALTER TABLE technician_services DROP COLUMN company_id;
ALTER TABLE technician_categories DROP COLUMN company_id;
ALTER TABLE technician_zones DROP COLUMN company_id;

ALTER TABLE technician_services ALTER COLUMN technician_id SET NOT NULL;
ALTER TABLE technician_categories ALTER COLUMN technician_id SET NOT NULL;
ALTER TABLE technician_zones ALTER COLUMN technician_id SET NOT NULL;

-- رجوع الفهارس الفريدة لشكلها الأصلي (بلا شرط جزئي على المالك).
DROP INDEX uq_technician_services_technician;
DROP INDEX uq_technician_categories_technician;
DROP INDEX uq_technician_zones_technician;
ALTER TABLE technician_services
  ADD CONSTRAINT technician_services_technician_id_service_id_key UNIQUE (technician_id, service_id);
ALTER TABLE technician_categories
  ADD CONSTRAINT technician_categories_technician_id_category_id_key UNIQUE (technician_id, category_id);
CREATE UNIQUE INDEX technician_zones_technician_id_service_zone_id_key
  ON technician_zones (technician_id, service_zone_id) WHERE deleted_at IS NULL;
