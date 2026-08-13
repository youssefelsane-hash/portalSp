-- baytak — 0068: حالة طلب جديدة لسياسة إلغاء الفني (راجع docs/10-integration-completion-tracker.md
-- "سياسة إلغاء الفني") — الطلب بيوصلها لما فني يلغي طلب كان العميل مختاره بنفسه (تفضيل صريح
-- requested_technician_id) ومفيش إعادة مطابقة تلقائية مفعّلة: الطلب الأصلي محفوظ (مش بيتلغي)،
-- بس محتاج العميل يختار فني بديل بنفسه بدل ما نعيّنله واحد صامت.
-- منفصلة في ملف لوحدها عمداً — قيمة enum جديدة لازم تتضاف في transaction منفصلة عن أي كود
-- بيستخدمها (قيد Postgres على ALTER TYPE ... ADD VALUE).
ALTER TYPE order_status ADD VALUE 'awaiting_technician_reselection';
