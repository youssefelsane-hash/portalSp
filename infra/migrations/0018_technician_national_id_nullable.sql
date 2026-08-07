-- baytak — 0018: national_id_encrypted بيتقبل NULL وقت إنشاء البروفايل
-- السبب: technician_profiles بيتعمل تلقائياً لحظة التسجيل (نفس نمط customer_profiles)،
-- والفني ساعتها لسه ما دخلش الرقم القومي — بيتجمع بعدين في مسار قبول الفني (§9.3 في الماستر بلان).
-- القاعدة الحاكمة تمنع تعديل migration اتعمله commit قبل كده، فالتصحيح هنا بـ ALTER في ملف جديد.

ALTER TABLE technician_profiles ALTER COLUMN national_id_encrypted DROP NOT NULL;
