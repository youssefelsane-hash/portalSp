-- baytak — 0069: ربط محرك الإنتاجية (service_standard_data) بالطلب الفعلي (قرار عمل من المالك)
-- كانت estimateDuration() موجودة ومختبرة (docs/06 §3.3-§3.6) بس معزولة تمامًا عن OrdersService.create()
-- — العميل يشوف تقدير المدة كمعاينة بس، مفيش أي حاجة بتتسجّل على الطلب نفسه ولا بتوصل لشاشات
-- الأدمن/الفني التشغيلية. الأعمدة دي snapshot وقت الحجز (لو الأدمن غيّر service_standard_data
-- بعدين، الطلبات القديمة تفضل موضّحة بالقيم اللي اتحسبت بيها وقتها — نفس فلسفة
-- service_pricing_evaluations للـpricing engine).

ALTER TABLE orders ADD COLUMN standard_data_id UUID NULL REFERENCES service_standard_data(id);
ALTER TABLE orders ADD COLUMN required_technicians SMALLINT NULL;
ALTER TABLE orders ADD COLUMN required_assistants SMALLINT NULL;
ALTER TABLE orders ADD COLUMN estimated_duration_days SMALLINT NULL;

COMMENT ON COLUMN orders.standard_data_id IS 'صف service_standard_data اللي المدة/الطاقم اتحسبوا منه وقت الحجز — null لو الخدمة formula أو fixed بلا بيانات قياسية.';
COMMENT ON COLUMN orders.required_technicians IS 'snapshot وقت الحجز من CatalogService.estimateDuration() — مختلف عن service_pricing_evaluations.computed_technicians (ده لخدمات formula، ده لخدمات standard_data).';
COMMENT ON COLUMN orders.required_assistants IS 'راجع required_technicians.';
COMMENT ON COLUMN orders.estimated_duration_days IS 'راجع required_technicians.';
