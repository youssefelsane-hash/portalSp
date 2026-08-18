-- Script 3 §7/§12 — دعم "وصف المشكلة بلغة طبيعية" (مثال: "المياه بتنزل من تحت الحوض") بدون
-- إضافة اعتماد AI مكلف — بالظبط زي ما السكريبت بيطلب صراحة: "Use catalog aliases, synonyms,
-- search... do NOT secretly add an expensive AI dependency". العمود ده بيسمح للأدمن يسجّل
-- مرادفات/عبارات عامية بيستخدمها العملاء فعليًا للخدمة، وendpoint البحث الجديد (GET /services/search)
-- بيدوّر فيه جنب الاسم/الوصف.
ALTER TABLE services ADD COLUMN search_keywords TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN services.search_keywords IS 'مرادفات/عبارات عامية يكتبها العملاء (بديل بحث بسيط بدل AI classification — راجع docs/16 §Phase 2b)';

-- GIN index لأداء البحث بالمصفوفة (unnest + ILIKE في الاستعلام، الفهرس ده بيخدم && operator
-- لو احتجنا مطابقة مباشرة لاحقًا؛ ILIKE substring search نفسه بيعتمد على sequential scan مقبول
-- لحجم الكتالوج الحالي، مفيش داعي pg_trgm لسه).
CREATE INDEX idx_services_search_keywords ON services USING GIN (search_keywords);
