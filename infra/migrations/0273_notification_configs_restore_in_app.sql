-- baytak — 0273: رجوع قناة in_app لكل أنواع الإشعارات (إصلاح «الإشعارات ما بقتش بتتبعت خالص»)

-- **بلاغ المالك، والسبب اتقاس مش اتخمّن.**
--
-- `notifyMultiChannel` موصوفة في الكود بالحرف: «in_app مضمون دايمًا + push/sms إضافي». الضمان
-- ده مكانش متنفّذ: `notify()` بلا قناة صريحة كانت بتقرا `default_channels` من الجدول ده
-- وتستخدمها **كبديل** للقنوات مش كإضافة عليها.
--
-- الحالة الفعلية على قاعدة تطوير حقيقية وقت البلاغ:
--
--   SELECT count(*) FROM notification_type_configs;                          -- 37
--   SELECT count(*) FROM notification_type_configs
--    WHERE NOT (default_channels @> '["in_app"]'::jsonb);                    -- 36
--
-- يعني ٣٦ نوع من ٣٧ — من ضمنهم `order_accepted` و`order_awaiting_quote_approval` و
-- `order_quote_decision` — كانوا `["push"]` بالظبط. النتيجة:
--
--   • مفيش أي صف `in_app` بيتعمل ⇒ صندوق الإشعارات جوّه التطبيق فاضي مهما حصل،
--   • والـpush بيفشل في أي بيئة بلا مزوّد حقيقي ⇒ **الحدث بيختفي من الوجود**.
--
-- وده حرفيًا وصف المالك: «حتى لما الطلب بيتقبل برضه ما لهاش أي أصل».
--
-- الإصلاح في الكود (`resolveConfiguredChannels` + `NotificationTypeConfigService.normalizeChannels`)
-- بيمنع تكرارها من هنا ورايح. الـmigration دي بتصلّح الصفوف الموجودة.
--
-- **إضافة بحتة**: بتضيف `in_app` للصفوف اللي مالهاش، ومابتشيلش أي قناة توصيل اختارها الأدمن،
-- ومابتلمسش أي صف فيه `in_app` أصلاً.

UPDATE notification_type_configs
   SET default_channels = (
         SELECT jsonb_agg(DISTINCT channel ORDER BY channel)
           FROM jsonb_array_elements_text(default_channels || '["in_app"]'::jsonb) AS channel
       ),
       updated_at = now()
 WHERE NOT (default_channels @> '["in_app"]'::jsonb);
