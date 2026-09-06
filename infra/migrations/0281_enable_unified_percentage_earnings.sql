-- سياسة النسبة الموحدة هي الافتراضية للطلبات الجديدة. لا يوجد زر تشغيل أو مسار واجهة ثانٍ؛
-- الفرع التاريخي يبقى فقط لتسوية طلبات سبقت الترحيل بأمان.
UPDATE settings
   SET value = 'true'::jsonb,
       updated_at = now()
 WHERE key = 'earnings.v2_cutover_enabled';
