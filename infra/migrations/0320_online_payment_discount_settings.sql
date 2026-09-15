-- خصم الدفع الإلكتروني — «هدية الدفع أونلاين» (ADR-0085، طلب مالك في جولة اختباره، docs/08 §141 بند ٥).
--
-- > «إحنا منزلين عليه خصم، زي هدية الدفع by InstaPay. أنا عايز العميل وهو بيدفع أول مرة —
-- >  قبل ما صفحة الطلب تفتح له أصلاً — يظهرله إن فيه دفع by InstaPay عليه ٣٠ جنيه خصم، أو
-- >  المبلغ اللي الأدمين محدده. ويظهرله بشكل لطيف، شطب على السعر القديم.»
--
-- الخصم ده **سياسة تشغيل دايمة على وسيلة دفع**، مش حملة تسويقية بكود — فمكانه الإعدادات مش
-- `promo_codes` (التفصيل الكامل في ADR-0085). القيمة والوسائل والنص كلهم من هنا، عشان تغييرهم
-- قرار من لوحة الأدمن بلا نشر جديد للتطبيق ولا للويب.
--
-- **مقفول افتراضيًا عن قصد**: العرض بيصرف فلوس حقيقية، فتشغيله لازم يكون قرار صريح من المالك
-- مش أثر جانبي لتطبيق migration — نفس قاعدة `marketing.first_order_offer_enabled` بالظبط.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.online_discount_enabled', 'false'::jsonb, 'boolean', 'payments',
   'تفعيل خصم الدفع الإلكتروني («هدية الدفع أونلاين»). مقفول افتراضيًا عن قصد — العرض بيصرف فلوس حقيقية.',
   true),
  ('payments.online_discount_cents', '3000'::jsonb, 'number', 'payments',
   'قيمة خصم الدفع الإلكتروني بالقرش (٣٠ ج.م افتراضيًا).',
   true),
  ('payments.online_discount_min_order_cents', '0'::jsonb, 'number', 'payments',
   'أقل إجمالي طلب يشتغل عليه خصم الدفع الإلكتروني بالقرش — بيمنع إن الخصم يبلع طلب صغير. صفر = بلا حد أدنى.',
   true),
  ('payments.online_discount_methods', '"instapay,card"'::jsonb, 'string', 'payments',
   'وسائل الدفع اللي عليها خصم الدفع الإلكتروني، مفصولة بفواصل (instapay,card,fawry_reference).',
   true),
  ('payments.online_discount_label_ar', '"وفّر {discount} ج.م لما تدفع دلوقتي"'::jsonb, 'string', 'payments',
   'نص وسم خصم الدفع الإلكتروني. {discount} بيتبدّل بالقيمة الفعلية وقت العرض، فتغيير المبلغ مايسيبش نص قديم بيكذب.',
   true)
ON CONFLICT (key) DO NOTHING;
