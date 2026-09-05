-- تكملة تدقيق D-1 — أنواع `enum` يتيمة مالهاش أي عمود.
--
-- حذف الجداول الميتة في 0265 ساب وراه أنواع enum مالهاش أي مستخدم. Postgres مابيحذفش النوع
-- تلقائيًا مع الجدول، فبيفضل في المخطّط كـ«مصطلح موجود في النظام» — وده نفس فئة التضليل
-- بالظبط: حد بيقرا المخطّط يلاقي `laundry_order_status` و`subscription_status` فيفتكر إن
-- فيه غسيل واشتراكات في المنتج.
--
-- **بلا `CASCADE` عمدًا**: لو أي عمود أو دالة لسه بيعتمد على أي نوع فيهم، `DROP TYPE` هتفشل
-- صراحةً وترجّع الـmigration كلها (كلها جوّه transaction) — وده المطلوب، مش الحذف الصامت.
--
-- التحقق قبل الكتابة: استعلام على `pg_type` + `pg_attribute` أثبت إن الـ23 نوع دول مالهمش أي
-- عمود في أي جدول حقيقي، و`grep` على `apps/api/src` و`apps/admin/src` و`packages` رجّع صفر
-- إشارة لأي اسم فيهم.

-- الغسيل (0012)
DROP TYPE IF EXISTS laundry_order_status;
DROP TYPE IF EXISTS laundry_item_status;
DROP TYPE IF EXISTS laundry_item_service_type;
DROP TYPE IF EXISTS laundry_partner_status;
DROP TYPE IF EXISTS laundry_dashboard_plan;

-- B2B (0013)
DROP TYPE IF EXISTS corporate_account_status;
DROP TYPE IF EXISTS corporate_account_type;
DROP TYPE IF EXISTS corporate_invoice_status;
DROP TYPE IF EXISTS corporate_property_type;
DROP TYPE IF EXISTS corporate_role;

-- تشخيص AI (0014)
DROP TYPE IF EXISTS ai_urgency_level;

-- الاشتراكات (0015)
DROP TYPE IF EXISTS subscription_status;
DROP TYPE IF EXISTS subscription_plan_type;
DROP TYPE IF EXISTS billing_cycle;

-- إدارة المنزل (0016)
DROP TYPE IF EXISTS home_appliance_condition;
DROP TYPE IF EXISTS home_document_type;
DROP TYPE IF EXISTS home_property_type;
DROP TYPE IF EXISTS maintenance_recurrence_type;

-- عاملات المنازل — الجداول بتاعتها اتشالت في migration أقدم والأنواع فضلت يتيمة من وقتها.
-- ملاحظة مهمة: `orders`/`users` لسه فيهم مفهوم `domestic_worker` (كنوع حجز/مستخدم)، بس
-- بيستخدموا أنواع تانية موجودة وشغالة — الأنواع دي تحديدًا مالهاش أي عمود.
DROP TYPE IF EXISTS domestic_worker_booking_status;
DROP TYPE IF EXISTS domestic_worker_booking_type;
DROP TYPE IF EXISTS domestic_worker_earning_approval_status;
DROP TYPE IF EXISTS domestic_worker_specialty;
DROP TYPE IF EXISTS domestic_worker_verification_status;
