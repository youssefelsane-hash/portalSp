-- baytak — 0163: قدرة خدمة جديدة cash_allowed (ADR-0026، docs/08 §42، Phase A.1 من محرك الحجز
-- الموحّد) — نفس نمط allows_individual/allows_team/allows_scheduling/allows_emergency الموجودين
-- بالفعل على services (0006/0051)، مش جدول تهيئة منفصل. الافتراضي true عمدًا: كل خدمة موجودة
-- تفضل بالظبط زي ما هي (كاش متاح)، والأدمن يقدر يقفلها صراحة لخدمة معيّنة بلا كود جديد.

ALTER TABLE services ADD COLUMN cash_allowed BOOLEAN NOT NULL DEFAULT true;
