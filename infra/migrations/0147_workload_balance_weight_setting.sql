-- baytak (صُنّاع) — 0147: وزن موازنة حِمل الفني في ترتيب المطابقة (ADR-0018 §7)
-- راجع docs/adr/0018-emergency-vs-scheduled-and-trade-eligibility.md للتصميم الكامل.
--
-- طلب صريح من المالك (2026-08-19): بعد ما الفني بقى متاح افتراضيًا (ADR-0017 بند 3)، كل الفنيين
-- المؤهلين بقوا "مرشّحين" دايمًا — من غير توازن حِمل، أعلى فني مستوى/أقرب هياخد كل الطلبات على
-- طول رغم إن فنيين تانيين مؤهلين بنفس القدر بس أقل انشغالاً. الوزن ده بيتضرب في عدد الطلبات
-- النشطة على الفني حاليًا (ACTIVE_TECHNICIAN_ORDER_STATUSES) وبيتطرح من order_priority_weight
-- في matching.service.ts's findEligibleTechnicians() قبل الترتيب — إضافة على معايير الترتيب
-- الموجودة (مستوى + مسافة)، مش استبدال ليها. قيمة صفر = تعطيل موازنة الحِمل (رجوع للسلوك القديم).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.workload_balance_weight', '2', 'number', 'matching',
   'وزن يتطرح من أولوية مستوى الفني (order_priority_weight) عن كل طلب نشط عليه حاليًا — عشان التوزيع يبقى متوازن مش دايمًا نفس الفني الأعلى مستوى/الأقرب (0 = تعطيل)', false);
