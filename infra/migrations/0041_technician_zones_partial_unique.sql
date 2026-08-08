-- baytak — 0041: تحويل UNIQUE(technician_id, service_zone_id) في technician_zones لـ partial index
-- (بيتجاهل الصفوف المحذوفة) — مرجع: apps/api/src/modules/technicians/README.md
-- (بَقّة حقيقية اتلقطت وقت اختبار حي لميزة إدارة مناطق العمل، نفس فئة بَقّة 0035_users_phone_number
-- بالحرف — soft-delete + قيد UNIQUE عادي على نفس الأعمدة)
--
-- technician_zones.deleted_at (0005_customers_technicians.sql) بيتفعّل عبر
-- AdminTechniciansService.removeZone() (soft delete حقيقي)، لكن UNIQUE(technician_id,
-- service_zone_id) كان قيد عادي بيشمل الصفوف المحذوفة — يعني أي منطقة اتشالت من فني وبعدين
-- اتحاول تتضاف تاني لنفس الفني كانت بترمي "duplicate key value violates unique constraint
-- technician_zones_technician_id_service_zone_id_key" (500 خام) بدل ما تنجح عادي. اتأكدت
-- البَقّة حياً: إزالة منطقة من فني ثم محاولة إعادة تعيينها لنفس الفني رمت الخطأ ده فعلياً.
ALTER TABLE technician_zones DROP CONSTRAINT technician_zones_technician_id_service_zone_id_key;

CREATE UNIQUE INDEX technician_zones_technician_id_service_zone_id_key
  ON technician_zones (technician_id, service_zone_id) WHERE deleted_at IS NULL;
