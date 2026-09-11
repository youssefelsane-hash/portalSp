-- تكملة قاعدة «كل مفتاح أجنبي أحادي العمود له فهرس» — الجولة التالتة (0265 ← 0267 ← دي).
--
-- `scripts/check-db-hygiene.js` كشف **١٣ مفتاح أجنبي** اتضافوا بعد 0267 وفاتوا القاعدة: جداول
-- العمولات التسويقية، وطابوري إشعارات الدفع والتكرار (outbox)، وتسويات الاسترداد، وتجاوزات
-- كتالوج المناطق.
--
-- **الخطر اللي بيتغطّى**: Postgres مابيعملش فهرس تلقائي على الطرف المُشير. حذف مستخدم واحد أو
-- طلب واحد بيعمل seq scan على **كل** جدول فيه عمود بيشاور عليه — والجداول دي بالذات بتكبر
-- بسرعة (كل دفعة وكل طلب متكرر بيكتب صف outbox).
--
-- الأعمدة اللي بتقبل NULL بتاخد فهرس جزئي (`WHERE ... IS NOT NULL`) — نفس نمط 0267 بالحرف:
-- مفيش لازمة لفهرسة صفوف القيمة فيها فاضية، وده بيوفّر مساحة وصيانة.
--
-- مش `CONCURRENTLY` لأن `migrate.js` بيلفّ كل ملف في transaction (نفس سبب 0265/0267).
--
-- migration-safety: ok كل الجداول السبعة دي فاضية أو شبه فاضية قبل الإطلاق — اتقاست فعليًا
-- على قاعدة التطوير قبل كتابة الملف: marketing_source_commissions=0، marketing_sources=2،
-- promo_code_marketing_commissions=0، payment_notification_outbox=0،
-- recurring_notification_outbox=0، refunds=2، service_zone_catalog_overrides=0. وده متوقّع في
-- الإنتاج كمان لأنها كلها جداول **ما اشتغلتش بعد** (عمولات تسويقية، طابور إشعارات، تسوية
-- استرداد). القفل على جدول فاضي لحظي. لو اتأجّل الملف ده لبعد ما الطابور يشتغل فعلاً، لازم
-- يتحوّل لـ`CONCURRENTLY` في ملف منفصل بره transaction.

-- عمولات المصادر التسويقية
CREATE INDEX IF NOT EXISTS idx_marketing_source_commissions_customer_user_id
  ON marketing_source_commissions(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_marketing_source_commissions_paid_by_user_id
  ON marketing_source_commissions(paid_by_user_id) WHERE paid_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_sources_created_by_user_id
  ON marketing_sources(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

-- عمولات أكواد الخصم التسويقية
CREATE INDEX IF NOT EXISTS idx_promo_code_marketing_commissions_customer_user_id
  ON promo_code_marketing_commissions(customer_user_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_marketing_commissions_paid_by_user_id
  ON promo_code_marketing_commissions(paid_by_user_id) WHERE paid_by_user_id IS NOT NULL;

-- طابور إشعارات الدفع (صف لكل دفعة)
CREATE INDEX IF NOT EXISTS idx_payment_notification_outbox_customer_profile_id
  ON payment_notification_outbox(customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_payment_notification_outbox_order_id
  ON payment_notification_outbox(order_id);

-- طابور إشعارات الطلبات المتكررة (صف لكل تكرار)
CREATE INDEX IF NOT EXISTS idx_recurring_notification_outbox_customer_profile_id
  ON recurring_notification_outbox(customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_recurring_notification_outbox_order_id
  ON recurring_notification_outbox(order_id);

-- تسوية الاستردادات
CREATE INDEX IF NOT EXISTS idx_refunds_reconciled_by_user_id
  ON refunds(reconciled_by_user_id) WHERE reconciled_by_user_id IS NOT NULL;

-- تجاوزات كتالوج المناطق
CREATE INDEX IF NOT EXISTS idx_service_zone_catalog_overrides_category_id
  ON service_zone_catalog_overrides(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_zone_catalog_overrides_created_by
  ON service_zone_catalog_overrides(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_zone_catalog_overrides_service_id
  ON service_zone_catalog_overrides(service_id) WHERE service_id IS NOT NULL;
