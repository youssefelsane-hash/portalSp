-- baytak (صُنّاع) — 0242: كل خدمة بقت معادلة ديناميكية (ADR-0060 §1، docs/08 §113).
--
-- قبل الملف ده كان `services.pricing_model` بيحمل ست قيم، كل واحدة **وضع تشغيل** ليه مسار تحقق
-- ومدخلات خاصة. ده اللي طلّع بلاغ المالك حرفيًا: خدمة شهرية بتطلب «عدد الوحدات» مفيش شاشة
-- بتطلبه، وأربع حقول تاريخ على نفس الشاشة.
--
-- الملف ده بيحوّل كل خدمة قائمة (`fixed`/`hourly`/`per_unit`/`monthly`) لـ`formula` بشجرة
-- `final_price` مكافئة تمامًا للحساب القديم، وبيزرع الحقول اللي الشجرة بتقرا منها.
-- `inspection_then_quote` مابتتغيرش — دي مش طريقة حساب، دي **غياب حساب وقت الحجز**.
--
-- ملحوظة على التكرار: الأشكال هنا مكتوبة SQL خام وهي نفس اللي `pricing-templates.ts` بيولّده.
-- ده **مقصود**: الـmigration لقطة تاريخية مجمّدة (قاعدة المشروع: ملف اتعمل commit مايتعدلش)،
-- فماينفعش تعتمد على كود بيتغيّر. التكافؤ مش مفترض — مُثبت في
-- `pricing-template-migration-parity.spec.ts` اللي بيقارن ناتج الشجرة المهاجَرة بناتج القالب
-- لنفس المدخلات.

-- 1) الخدمات ذات السعر الثابت — الشجرة = الرقم نفسه.
INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
SELECT
  s.id,
  'formula'::pricing_rule_type,
  'final_price',
  jsonb_strip_nulls(jsonb_build_object(
    'price_cents', jsonb_build_object('type', 'literal', 'value', s.base_price_cents),
    'min_price_cents', CASE WHEN s.min_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.min_price_cents) END,
    'max_price_cents', CASE WHEN s.max_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.max_price_cents) END
  )),
  0,
  now(),
  true
FROM services s
WHERE s.pricing_model = 'fixed'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_rules r
    WHERE r.service_id = s.id AND r.rule_key = 'final_price' AND r.deleted_at IS NULL
  );

-- 2) الخدمات بالساعة — حقل «عدد الساعات» في الفورم، والشجرة بتضرب فيه.
INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, min_value, max_value)
SELECT s.id, 'hours', 'عدد الساعات المطلوبة', 'number'::pricing_field_type, true, 10, 'ساعة', 1, 24
FROM services s
WHERE s.pricing_model = 'hourly'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_fields f
    WHERE f.service_id = s.id AND f.field_key = 'hours' AND f.deleted_at IS NULL
  );

INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
SELECT
  s.id,
  'formula'::pricing_rule_type,
  'final_price',
  jsonb_strip_nulls(jsonb_build_object(
    'price_cents', jsonb_build_object(
      'type', 'multiply',
      'operands', jsonb_build_array(
        jsonb_build_object('type', 'field_ref', 'field_key', 'hours'),
        jsonb_build_object('type', 'literal', 'value', s.base_price_cents)
      )
    ),
    'min_price_cents', CASE WHEN s.min_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.min_price_cents) END,
    'max_price_cents', CASE WHEN s.max_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.max_price_cents) END
  )),
  0, now(), true
FROM services s
WHERE s.pricing_model = 'hourly'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_rules r
    WHERE r.service_id = s.id AND r.rule_key = 'final_price' AND r.deleted_at IS NULL
  );

-- 3) الخدمات بالوحدة/بالقطعة — حقل «الكمية».
INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, min_value, max_value)
SELECT s.id, 'units', 'الكمية المطلوبة', 'number'::pricing_field_type, true, 10, 'وحدة', 1, 1000
FROM services s
WHERE s.pricing_model = 'per_unit'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_fields f
    WHERE f.service_id = s.id AND f.field_key = 'units' AND f.deleted_at IS NULL
  );

INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
SELECT
  s.id,
  'formula'::pricing_rule_type,
  'final_price',
  jsonb_strip_nulls(jsonb_build_object(
    'price_cents', jsonb_build_object(
      'type', 'multiply',
      'operands', jsonb_build_array(
        jsonb_build_object('type', 'field_ref', 'field_key', 'units'),
        jsonb_build_object('type', 'literal', 'value', s.base_price_cents)
      )
    ),
    'min_price_cents', CASE WHEN s.min_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.min_price_cents) END,
    'max_price_cents', CASE WHEN s.max_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.max_price_cents) END
  )),
  0, now(), true
FROM services s
WHERE s.pricing_model = 'per_unit'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_rules r
    WHERE r.service_id = s.id AND r.rule_key = 'final_price' AND r.deleted_at IS NULL
  );

-- 4) الخدمات الشهرية — حقلين تاريخ في الفورم (مش `period_start/end` النظاميين). ده اللي بيخلي
--    مصدر التواريخ واحد في المنظومة كلها ويقفل عرض «أربع حقول تاريخ» بنيويًا.
INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, display_order)
SELECT s.id, 'period_start', 'تاريخ بداية الاشتراك', 'date'::pricing_field_type, true, 10
FROM services s
WHERE s.pricing_model = 'monthly'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_fields f
    WHERE f.service_id = s.id AND f.field_key = 'period_start' AND f.deleted_at IS NULL
  );

INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required, display_order)
SELECT s.id, 'period_end', 'تاريخ نهاية الاشتراك', 'date'::pricing_field_type, true, 20
FROM services s
WHERE s.pricing_model = 'monthly'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_fields f
    WHERE f.service_id = s.id AND f.field_key = 'period_end' AND f.deleted_at IS NULL
  );

INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
SELECT
  s.id,
  'formula'::pricing_rule_type,
  'final_price',
  jsonb_strip_nulls(jsonb_build_object(
    'price_cents', jsonb_build_object(
      'type', 'multiply',
      'operands', jsonb_build_array(
        jsonb_build_object(
          'type', 'max',
          'operands', jsonb_build_array(
            jsonb_build_object(
              'type', 'date_diff',
              'from', jsonb_build_object('kind', 'field', 'field_key', 'period_start'),
              'to', jsonb_build_object('kind', 'field', 'field_key', 'period_end'),
              'unit', 'months',
              'rounding', 'ceil'
            ),
            jsonb_build_object('type', 'literal', 'value', 1)
          )
        ),
        jsonb_build_object('type', 'literal', 'value', s.base_price_cents)
      )
    ),
    'min_price_cents', CASE WHEN s.min_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.min_price_cents) END,
    'max_price_cents', CASE WHEN s.max_price_cents IS NULL THEN NULL
                            ELSE jsonb_build_object('type', 'literal', 'value', s.max_price_cents) END
  )),
  0, now(), true
FROM services s
WHERE s.pricing_model = 'monthly'
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_rules r
    WHERE r.service_id = s.id AND r.rule_key = 'final_price' AND r.deleted_at IS NULL
  );

-- 5) التحويل نفسه. بعد الخطوة دي مفيش أي صف في `services` عليه طريقة حساب غير `formula` أو
--    `inspection_then_quote`.
UPDATE services
SET pricing_model = 'formula'
WHERE pricing_model IN ('fixed', 'hourly', 'per_unit', 'monthly');

-- 6) قيد يمنع رجوع القيم القديمة من أي مسار (كود قديم، سكريبت يدوي، seed). قيمة الـenum نفسها
--    في PostgreSQL بتفضل موجودة عمدًا — مسح قيمة enum مستخدمة في أعمدة تاريخية عملية خطرة بلا
--    مقابل، ونفس المبدأ المطبّق على 'worker_rate' في service.entity.ts.
ALTER TABLE services
  ADD CONSTRAINT chk_services_pricing_model_supported
  CHECK (pricing_model IN ('formula', 'inspection_then_quote'));
