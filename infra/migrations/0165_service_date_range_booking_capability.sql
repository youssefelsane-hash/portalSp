-- baytak — 0165: قدرة "نطاق أيام مرن" لكل خدمة (allows_date_range_booking) — ADR-0028، docs/08 §42
-- Phase A.2 من محرك الحجز الموحّد. نفس نمط cash_allowed/deposit_required بالحرف: علم مباشر على
-- services، مش محرك جدولة جديد — منطق حل النطاق (OrdersService.create()) وTechniciansService.
-- hasEligibleTechnicianForDate() موجودين بالفعل ومش بيتلمسوا هنا خالص. الافتراضي true عمدًا: خيار
-- "مرن — اختار نطاق أيام" متاح فعليًا لكل خدمة اليوم بلا أي فحص قدرة (customer-app بيعرضه
-- بلا شرط)، فالعلم ده تحويل الوضع الحالي لقدرة صريحة قابلة للإقفال، مش قيد جديد افتراضيًا.

ALTER TABLE services ADD COLUMN allows_date_range_booking BOOLEAN NOT NULL DEFAULT true;
