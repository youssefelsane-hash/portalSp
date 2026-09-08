-- سياسة المستحقات الواحدة: عمولة المنصة نسبة محفوظة على الطلب، لا مبلغ ثابت من الكتالوج.
-- الطلبات القديمة التي كانت على سياسة 2 تأخذ نسبة الخدمة الحالية كترحيل لمرة واحدة؛ الطلبات
-- الجديدة تحفظ اللقطة عند الحجز فلا تتأثر بأي تعديل لاحق في الكتالوج.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_v2_has_fixed_commission_snapshot;

UPDATE orders o
   SET commission_rate_applied = s.commission_percentage
  FROM services s
 WHERE o.service_id = s.id
   AND o.settlement_policy_version = 2
   AND o.commission_rate_applied IS NULL;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_earnings_policy_has_commission_rate_snapshot
  CHECK (settlement_policy_version <> 2 OR commission_rate_applied IS NOT NULL);
