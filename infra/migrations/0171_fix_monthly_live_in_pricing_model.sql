-- baytak — 0171: تصحيح pricing_model لخدمة "تنظيف شهري / إقامة" (ADR-0031 Slice B/G)
-- migration 0170 كانت بتحطّ 'hourly' على كل الأربع خدمات بنفس القيمة الثابتة من غير تمييز —
-- بَقّة حقيقية اتلقطت وقت ربط CatalogService.estimate() بمنطق ضرب duration_hours: سعر عاملة
-- التنظيف المقيمة (5000 جنيه) سعر شهري ثابت، مش سعر ساعة يتضرب في عدد ساعات — requires_precise_schedule
-- بتاعها false أصلاً (مفيش duration_hours بيتبعت لها من CreateOrderDto validation)، فالسلوك
-- العملي مكنش هيتغيّر، لكن pricing_model الصحيح دلالياً هو 'fixed' مش 'hourly' — مينفعش تتعدّل
-- migration 0170 القديمة (اتعمل commit)، فده migration جديد بدل ما نعدّل القديم.

UPDATE services SET pricing_model = 'fixed'
WHERE slug = 'cleaning-monthly-live-in' AND pricing_model = 'hourly';
