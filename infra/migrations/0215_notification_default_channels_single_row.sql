-- baytak — 0215: قناة واحدة افتراضية للإشعارات (بَقّة حقيقية اتلقطت، طلب مالك مباشر، docs/08 §92)
--
-- المشكلة: notification_type_configs.default_channels كانت افتراضيًا '["push","in_app"]' —
-- notifyMultiChannel() (notifications.service.ts) بتعمل صف Notification مستقل لكل قناة. النتيجة:
-- كل حدث بيستخدم notify() (بدون تحديد قناة صريح، وهو أغلب الاستخدام في المشروع — order_created،
-- order_technician_on_way/arrived، order_in_progress، إلخ) كان بيعمل **صفين** متطابقين في النص،
-- والعميل/الفني بيشوفهم في قايمة الإشعارات كأنهم إشعارين منفصلين لنفس الحاجة بالظبط. عدّاد
-- "غير مقروء" كان بيتضاعف بنفس المنطق. تأكيدات الدفع (payment_instapay_confirmed) كانت الاستثناء
-- الوحيد اللي بيوصل مرة واحدة صح — مش لأن فيها معالجة خاصة، لكن لأنها أصلاً معندهاش صف إعداد في
-- الجدول ده خالص، فبترجع لسلوك fallback مختلف (in_app بس، مفيش push).
--
-- الحل: صف الـpush نفسه بيتسجّل في notifications بغض النظر عن نجاح التسليم الفعلي (الإرسال
-- الحقيقي عبر FCM منفصل تمامًا عن الـINSERT)، فهو بيغطي ظهور الإشعار في القايمة **وبرضه** محاولة
-- push حقيقية — قناة in_app منفصلة زيادة عليه صف مكرر بحت مالوش قيمة إضافية. القيمة الافتراضية
-- بقت ["push"] بس. أي notification_type محتاج قنوات إضافية فعليًا (SMS مثلاً لتنبيه حرج) الأدمن
-- لسه يقدر يظبطها يدويًا من `/settings` (الجدول ده "مُدار بالكامل من الأدمن" زي ما موثّق في
-- COMMENT الجدول الأصلي) — التحديث هنا بيلمس بس الصفوف اللي لسه على القيمة الافتراضية القديمة
-- (يعني محدش أدمن غيّرها يدويًا لحاجة تانية عمدًا).

ALTER TABLE notification_type_configs ALTER COLUMN default_channels SET DEFAULT '["push"]';

UPDATE notification_type_configs
SET default_channels = '["push"]'
WHERE default_channels = '["push","in_app"]'::jsonb;
