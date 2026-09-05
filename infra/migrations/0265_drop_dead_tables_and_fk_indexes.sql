-- تدقيق D-1 + D-3 + DB-1 — تنظيف مخطّط قاعدة البيانات وفهارس المفاتيح الأجنبية.
--
-- تلات نتايج تدقيق منفصلة بس كلها في نفس الطبقة، فمنطقي تتعمل في migration واحدة:
--   D-1: ١٦ جدول ميت تمامًا (صفر صفوف، صفر مراجع في الكود).
--   D-3: فهرسان مكرّران على `orders` بيتصانوا من غير أي مقابل.
--   DB-1: ٣٣ مفتاح أجنبي على الجداول الساخنة بلا فهرس داعم.

-- ═══════════════════════════════════════════════════════════════════════════
-- بوابة أمان — الحذف مايتمّش أبدًا على جدول فيه بيانات
-- ═══════════════════════════════════════════════════════════════════════════
-- التحقق اتعمل على قاعدة التطوير (كلهم صفر صفوف)، بس الـmigration دي هتشتغل على بيئات
-- تانية مش شايفها. لو أي جدول فيهم فيه صف واحد في أي بيئة، معناها إن افتراض «ميت» غلط
-- هناك — والصح وقتها إن الـmigration **تفشل بصوت عالي** مش إنها تمسح بيانات حقيقية.
-- الـmigration كلها جوّه transaction (راجع `migrate.js`)، فالفشل بيرجّع كل حاجة.
DO $$
DECLARE
  dead_table text;
  row_count  bigint;
BEGIN
  FOREACH dead_table IN ARRAY ARRAY[
    'laundry_items', 'laundry_orders', 'laundry_partners',
    'corporate_invoices', 'corporate_users', 'corporate_properties', 'corporate_accounts',
    'maintenance_schedules', 'home_appliances', 'home_documents', 'home_profiles',
    'subscriptions', 'subscription_plans',
    'ai_diagnoses', 'project_attachments', 'technician_availability'
  ] LOOP
    IF to_regclass('public.' || dead_table) IS NULL THEN
      CONTINUE; -- اتشال قبل كده في بيئة تانية — مش خطأ.
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', dead_table) INTO row_count;
    IF row_count > 0 THEN
      RAISE EXCEPTION
        'الجدول %I فيه % صف — الافتراض إنه ميت مش صحيح في البيئة دي. الحذف اتوقف بالكامل.',
        dead_table, row_count;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- D-1 — حذف الجداول الميتة
-- ═══════════════════════════════════════════════════════════════════════════
-- دي بقايا مراحل من الماستر بلان الأصلي **ماتنفّذتش أبدًا** (غسيل، B2B، تشخيص AI،
-- اشتراكات، إدارة المنزل). كل واحد فيهم: صفر صفوف، صفر مراجع في الكود، وصفر مفاتيح أجنبية
-- من أي جدول حي (اتأكد بـ`pg_constraint`).
--
-- **ليه الحذف مش مجرد تجاهل**: `technician_availability` أوضح مثال — الاسم بيوحي إنه مصدر
-- توافر الفني، بينما المصدر الحقيقي بقى `technician_schedule_slots` من ADR-0018. أي مطوّر
-- أو AI جديد بيدوّر على «توافر الفني» بيلاقي الجدول الغلط الأول. المخطّط الميت مش مساحة
-- ضايعة، ده **تضليل نشط**.
--
-- الترتيب بالاعتماديات (الأبناء الأول) عمدًا بدل `CASCADE`: لو تحليل الاعتماديات غلط في أي
-- نقطة، عايزين الـmigration تفشل صراحةً مش تمسح حاجة مش مقصودة بصمت.

-- الغسيل (0012_phase3_laundry.sql)
DROP TABLE IF EXISTS laundry_items;
DROP TABLE IF EXISTS laundry_orders;
DROP TABLE IF EXISTS laundry_partners;

-- B2B (0013_phase4_b2b.sql)
DROP TABLE IF EXISTS corporate_invoices;
DROP TABLE IF EXISTS corporate_users;
DROP TABLE IF EXISTS corporate_properties;
DROP TABLE IF EXISTS corporate_accounts;

-- إدارة المنزل (0016_phase8_home_management.sql)
DROP TABLE IF EXISTS maintenance_schedules;
DROP TABLE IF EXISTS home_appliances;
DROP TABLE IF EXISTS home_documents;
DROP TABLE IF EXISTS home_profiles;

-- الاشتراكات (0015_phase7_subscriptions.sql)
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS subscription_plans;

-- تشخيص AI (0014_phase5_ai.sql)
DROP TABLE IF EXISTS ai_diagnoses;

-- مرفقات المشاريع (0178) — اتعمل ومااتربطش بأي كود
DROP TABLE IF EXISTS project_attachments;

-- توافر الفني القديم (0005) — اتاستبدل بـ`technician_schedule_slots` (ADR-0018)
DROP TABLE IF EXISTS technician_availability;

-- ═══════════════════════════════════════════════════════════════════════════
-- D-3 — فهرسان مكرّران على `orders`
-- ═══════════════════════════════════════════════════════════════════════════
-- `orders_order_number_key` (UNIQUE على `order_number`) بيخدم كل استعلامات البحث برقم الطلب،
-- فالفهرس العادي على نفس العمود زيادة بحتة.
DROP INDEX IF EXISTS idx_orders_order_number;

-- `idx_orders_project` و`idx_orders_project_id` تعريفهم **متطابق حرفيًا** (نفس العمود ونفس
-- الشرط الجزئي) — اتعملوا في migrations مختلفة بأسماء مختلفة.
DROP INDEX IF EXISTS idx_orders_project;

-- ═══════════════════════════════════════════════════════════════════════════
-- DB-1 — فهارس المفاتيح الأجنبية الناقصة على الجداول الساخنة
-- ═══════════════════════════════════════════════════════════════════════════
-- **الخطر الأكبر مش الاستعلامات، هو الـFK نفسه**: Postgres مابيعملش فهرس تلقائي على الطرف
-- المُشير. يعني أي `DELETE`/`UPDATE` على الجدول **الأب** بيجبره يعمل seq scan على الابن كله
-- عشان يتحقق من القيد. مثال حقيقي: أدمن بيمسح/يعدّل خدمة ⇒ seq scan على `orders` كله، وهو
-- أكبر جدول في النظام.
--
-- المشكلة **غير مرئية تمامًا** دلوقتي (بيانات التطوير صغيرة) وبتظهر فجأة مع النمو — وده
-- بالظبط سبب عملها دلوقتي وهي رخيصة.
--
-- الأعمدة اللي بتقبل NULL بتاخد فهرس **جزئي** (`WHERE ... IS NOT NULL`): أغلبها فاضي في
-- معظم الصفوف، فالفهرس الجزئي بيوفّر مساحة وتكلفة صيانة من غير ما يخسر أي فايدة — نفس
-- النمط المتّبع في فهارس `orders` القايمة.
--
-- **مش `CONCURRENTLY`** عمدًا: `migrate.js` بيلفّ كل ملف في transaction، و`CONCURRENTLY`
-- ممنوعة جوّه transaction. الجداول لسه صغيرة فالقفل لحظي.

-- orders — أهمهم `service_id` (مكانش عليه أي فهرس خالص) و`address_id`
CREATE INDEX IF NOT EXISTS idx_orders_service_id ON orders(service_id);
CREATE INDEX IF NOT EXISTS idx_orders_address_id ON orders(address_id);
CREATE INDEX IF NOT EXISTS idx_orders_cancellation_reason_id ON orders(cancellation_reason_id) WHERE cancellation_reason_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by_user_id ON orders(cancelled_by_user_id) WHERE cancelled_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_promo_code_id ON orders(promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_requested_technician_id ON orders(requested_technician_id) WHERE requested_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_requested_technician_company_id ON orders(requested_technician_company_id) WHERE requested_technician_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_revisit_pinned_technician_id ON orders(revisit_pinned_technician_id) WHERE revisit_pinned_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_selected_match_preview_id ON orders(selected_match_preview_id) WHERE selected_match_preview_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_standard_data_id ON orders(standard_data_id) WHERE standard_data_id IS NOT NULL;

-- المال — الدفعات والاسترداد والمحفظة والتقسيط
CREATE INDEX IF NOT EXISTS idx_payments_collected_by_user_id ON payments(collected_by_user_id) WHERE collected_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_installment_id ON payments(installment_id) WHERE installment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_installments_payment_id ON installments(payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by_user_id ON refunds(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_approved_by_user_id ON refunds(approved_by_user_id) WHERE approved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_performed_by_user_id ON wallet_transactions(performed_by_user_id) WHERE performed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reversal_transaction_id ON wallet_transactions(reversal_transaction_id) WHERE reversal_transaction_id IS NOT NULL;

-- الجداول الملحقة بالطلب (بتكبر بمعدّل الطلبات نفسه أو أسرع)
CREATE INDEX IF NOT EXISTS idx_order_status_history_changed_by_user_id ON order_status_history(changed_by_user_id) WHERE changed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_added_by_user_id ON order_items(added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_declined_by_user_id ON order_items(declined_by_user_id) WHERE declined_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_media_uploaded_by_user_id ON order_media(uploaded_by_user_id);
CREATE INDEX IF NOT EXISTS idx_order_media_pricing_field_upload_id ON order_media(pricing_field_upload_id) WHERE pricing_field_upload_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_media_problem_image_upload_id ON order_media(problem_image_upload_id) WHERE problem_image_upload_id IS NOT NULL;

-- الشات والتقييمات
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_user_id ON chat_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated_by_user_id ON ratings(rated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_moderated_by_user_id ON ratings(moderated_by_user_id) WHERE moderated_by_user_id IS NOT NULL;

-- بروفايلات الفنيين والعملاء — أصغر، بس حذف مستخدم/عنوان بيمسحها seq scan من غير الفهارس دي
CREATE INDEX IF NOT EXISTS idx_technician_profiles_approved_by_user_id ON technician_profiles(approved_by_user_id) WHERE approved_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_profiles_assistant_technician_id ON technician_profiles(assistant_technician_id) WHERE assistant_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_profiles_branch_id ON technician_profiles(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_profiles_home_area_id ON technician_profiles(home_area_id) WHERE home_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_profiles_national_id_set_by_user_id ON technician_profiles(national_id_set_by_user_id) WHERE national_id_set_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_profiles_trust_verified_by ON technician_profiles(trust_verified_by) WHERE trust_verified_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_profiles_default_address_id ON customer_profiles(default_address_id) WHERE default_address_id IS NOT NULL;
