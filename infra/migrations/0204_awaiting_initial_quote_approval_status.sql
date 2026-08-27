-- baytak — 0204: حالة طلب جديدة لوضع الحجز "معاينة-ثم-سعر" (ADR-0044، docs/08 §73 بند 1) —
-- بعد ما الفني يوصل ويعاين المكان لخدمة pricing_model=inspection_then_quote، بيحدد سعر أول
-- (InspectionQuoteService.submitInitialQuote())، والطلب بيوصل الحالة دي لحد ما العميل يوافق.
-- مختلفة عمداً عن awaiting_quote_approval الموجودة (دي بتضيف على سعر مؤسَّس بالفعل أثناء شغل
-- شغال، مش بتؤسس أول سعر لطلب لسه بلا سعر) — راجع ADR-0044 قسم "البدائل اللي اتقيّمت".
-- منفصلة في ملف لوحدها عمداً — قيمة enum جديدة لازم تتضاف في transaction منفصلة عن أي كود
-- بيستخدمها (قيد Postgres على ALTER TYPE ... ADD VALUE)، نفس نمط migration 0068 بالحرف.
ALTER TYPE order_status ADD VALUE 'awaiting_initial_quote_approval';
