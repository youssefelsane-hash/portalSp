-- إصلاح تقدّمي: رجّع صفوف إعدادات اتمسحت بالغلط من تنظيف التدقيقات الحية.
--
-- **السبب الجذري** (اتصلح في `scripts/lib/live-harness.js`): `cascadeDelete()` كانت بتحذف أي صف
-- بيشاور على المستخدم اللي بيتمسح. بس أعمدة زي `settings.updated_by_user_id` مش «ملكية» — دي
-- **بصمة مين آخر واحد عدّل**. فأدمن الاختبار اللي بيعدّل إعدادًا من مسار الأدمن الحقيقي، وبعدين
-- التنظيف بيمسحه، كان بياخد معاه **الصف العام المملوك للنظام**.
--
-- **الضرر اتقاس مش متوقّع**: `ops.alert_stuck_searching_minutes` (عدّله تدقيق ج-٧) اختفى من
-- القاعدة، وكذلك مفتاحَي إيقاف الحجز في أول تشغيلة لتدقيق ج-١٧. الأثر العملي إن
-- `PATCH /admin/settings/:key` بيرجّع `404 الإعداد غير موجود` — يعني **مفتاح الطوارئ نفسه بيختفي
-- بلا أي إنذار**، وبالظبط وقت الحادثة لما المالك يحتاجه.
--
-- الإصلاح هنا **بذر تعويضي idempotent**: بيرجّع أي مفتاح من التلاتة لو مش موجود، وبيسيبه زي ما هو
-- لو موجود (يعني ما بيدوسش على أي ضبط تشغيلي المالك غيّره). القيم مطابقة للبذر الأصلي في
-- `0304_ops_alert_thresholds.sql` و`0305_booking_kill_switches.sql` بالحرف.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
SELECT v.key, v.value::jsonb, v.value_type, v.group_name, v.description, false
FROM (VALUES
  ('ops.alert_stuck_searching_minutes', '30', 'number', 'ops',
   'مدة بقاء الطلب بيدوّر على فني بالدقايق اللي بعدها يعتبر عالق'),
  ('orders.new_bookings_enabled', 'true', 'boolean', 'orders',
   'مفتاح طوارئ: لما يتقفل، أي طلب جديد بيترفض برسالة عربية مؤقتة. الطلبات القائمة وتنفيذها ودفعها وإلغاؤها بتفضل شغّالة عادي.'),
  ('orders.emergency_bookings_enabled', 'true', 'boolean', 'orders',
   'مفتاح طوارئ أضيق: بيوقف حجوزات نفس اليوم (الطوارئ) وحدها والحجز العادي يفضل شغّال. مفيد لما المشكلة في الطوارئ بس فإيقاف الحجز كله يبقى عقوبة جماعية.')
) AS v(key, value, value_type, group_name, description)
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = v.key);
