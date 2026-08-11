-- baytak (صُنّاع) — 0053: إعداد حجم دفعة بث الطوارئ (docs/06 §1.7، docs/07 الجزء ج)
-- المالك طلب صراحة: طلب الطوارئ "بيوصل لكل الناس القريبة منه كله بلا استثناء... يروح لأول عشرة،
-- أول عشرة لما حدش رد بعد ~30 ثانية بعد كده بيروح للناس اللي بعدهم". آلية الموجات (batch/timeout/
-- rounds) موجودة بالفعل في matching module — القيمة الوحيدة المختلفة فعليًا لطلبات الطوارئ هي
-- حجم الدفعة نفسها (matching.batch_size العادي = 5، هنا "أول عشرة" بالحرف من كلام المالك).
-- matching.response_timeout_seconds و matching.max_rounds بيتشاركوا مع الوضع العادي عمدًا —
-- مفيش داعي مُوثّق لتوقيت مختلف، بس الأدمن يقدر يضيفهم لاحقًا لو ظهرت حاجة فعلية.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.emergency_batch_size', '10', 'number', 'matching', 'عدد الفنيين في كل دفعة توزيع لطلبات "طوارئ" — بيتجاهل حالة is_available/is_on_duty، مش بديل عن الفلترة العادية', false);

-- إشعار فوري للمانجر عند أي طلب طوارئ (docs/06 §1.7/§2.2) — نفس آلية notification_routing_rules
-- الموجودة (0030/0036)، مش endpoint جديد. الأدمن يقدر يعدّل/يضيف أدوار تانية لاحقًا من
-- /admin/notification-routing-rules من غير أي كود جديد.
INSERT INTO notification_routing_rules (event_type, role_name, channels) VALUES
  ('order.emergency_created', 'ops_manager', '["in_app"]');
