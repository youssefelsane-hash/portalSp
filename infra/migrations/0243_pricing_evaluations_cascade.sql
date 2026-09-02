-- baytak (صُنّاع) — 0243: لقطات تقييم التسعير بتتمسح مع الطلب/الخدمة بتاعتها.
--
-- `service_pricing_evaluations` صف تدقيقي بيسجّل «السعر ده اتحسب إزاي وقتها». بعد ADR-0060 بقت
-- **كل** خدمة معادلة، يعني كل طلب بيولّد صف هنا — وقبل كده كان ده بيحصل لخدمات formula بس (اللي
-- كانت صفر خدمة فعليًا).
--
-- المشكلة اللي ظهرت: المفاتيح الأجنبية كانت RESTRICT ضمنيًا، فأي حذف حقيقي لطلب أو خدمة بيفشل
-- على صف تدقيقي مالوش أي معنى من غير أبوه. ده مابيحصلش في الإنتاج (الحذف soft delete)، بس
-- بيكسر تنظيف الاختبارات الحية — وهو نفس النمط اللي المشروع وثّقه قبل كده كـ«فشل تنظيف بيخلي
-- سويت سليمة تظهر حمرا».
--
-- CASCADE هو التوصيف الصحيح للعلاقة: اللقطة تابعة، مش كيان مستقل.
ALTER TABLE service_pricing_evaluations
  DROP CONSTRAINT service_pricing_evaluations_order_id_fkey,
  ADD CONSTRAINT service_pricing_evaluations_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

ALTER TABLE service_pricing_evaluations
  DROP CONSTRAINT service_pricing_evaluations_service_id_fkey,
  ADD CONSTRAINT service_pricing_evaluations_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
