-- baytak (صُنّاع) — 0057: محرك التسعير الديناميكي (Pricing Engine)
-- راجع docs/08-pricing-engine-and-platform-vision.md §1 وdocs/adr/0001-dynamic-pricing-engine.md
-- للقرار المعماري الكامل قبل ما تلمس الملف ده. خلاصة القرار: الحقول والقواعد بتتخزن هنا في
-- الداتابيز (مش hardcoded)، والمعادلة نفسها structured JSON (شجرة عمليات محدودة سلفًا) بيقرأها
-- evaluator آمن في الكود — ممنوع تمامًا أي تفسير لنص حر كجافاسكريبت/SQL (ثغرة أمان مباشرة).

-- إضافة فوق services.pricing_model الموجود، مش استبدال — خدمات fixed/hourly/per_unit/
-- inspection_then_quote تفضل شغالة زي ما هي بالظبط. أي خدمة pricing_model='formula' بتفعّل
-- الحقول الديناميكية + المعادلة تحت بدل السعر الثابت.
ALTER TYPE pricing_model ADD VALUE 'formula';

-- أنواع الحقول المدعومة في الفورم الديناميكي — راجع §1.4 في docs/08. القايمة دي enum جديد
-- (مش VARCHAR حر) عشان أي قيمة غلط ترفض من الداتابيز نفسها، مش تكتشف متأخر في الكود.
CREATE TYPE pricing_field_type AS ENUM (
  'number', 'dropdown', 'multi_select', 'checkbox', 'slider',
  'area', 'length', 'volume', 'date', 'time', 'location',
  'image_upload', 'video_upload', 'voice_note'
);

-- نوع صف القاعدة — ثابت رقمي، جدول بحث (lookup)، أو المعادلة النهائية نفسها.
CREATE TYPE pricing_rule_type AS ENUM ('constant', 'lookup_table', 'formula');

-- الحقول اللي العميل هيدخلها لخدمة pricing_model='formula' معيّنة — كل صف حقل واحد.
CREATE TABLE service_pricing_fields (
  id            UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id    UUID                NOT NULL REFERENCES services(id),
  -- اسم برمجي فريد داخل الخدمة الواحدة (مش عالميًا) — بيتستخدم كمرجع (field_ref) جوّه المعادلة.
  field_key     VARCHAR(60)         NOT NULL,
  label_ar      VARCHAR(120)        NOT NULL,
  field_type    pricing_field_type  NOT NULL,
  is_required   BOOLEAN             NOT NULL DEFAULT true,
  display_order SMALLINT            NOT NULL DEFAULT 0,
  unit_ar       VARCHAR(20)         NULL,
  -- لقيم dropdown/multi_select: [{"value": "internal", "label_ar": "داخلي"}, ...]. لباقي
  -- الأنواع بتفضل NULL.
  options       JSONB               NULL,
  min_value     NUMERIC(12, 2)      NULL,
  max_value     NUMERIC(12, 2)      NULL,
  is_active     BOOLEAN             NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ         NULL,
  UNIQUE (service_id, field_key)
);
CREATE INDEX idx_service_pricing_fields_service_id ON service_pricing_fields(service_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_pricing_fields
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- قواعد التسعير (ثوابت/جداول بحث/المعادلة النهائية) — نفس فلسفة service_zone_pricing بالظبط:
-- تسعير بتاريخ سريان (valid_from/valid_until)، الطلبات القديمة بتفضل بأسعارها وقت الحساب.
CREATE TABLE service_pricing_rules (
  id            UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id    UUID                NOT NULL REFERENCES services(id),
  rule_type     pricing_rule_type   NOT NULL,
  -- اسم مرجعي — للمعادلة النهائية دايمًا 'final_price' (صف واحد نشط بالاسم ده في كل لحظة لكل
  -- خدمة)، لباقي الأنواع (constant/lookup_table) أي اسم يعبّر عن القيمة زي 'price_per_meter'.
  rule_key      VARCHAR(80)         NOT NULL,
  -- الشكل بيختلف حسب rule_type:
  --   constant:      {"value": 140}
  --   lookup_table:  {"field_key": "wall_type", "values": {"internal": 140, "external": 165}}
  --   formula:       شجرة العمليات الكاملة (field_ref/constant_ref/lookup_ref/add/subtract/
  --                  multiply/divide/percentage/min/max/round/if) — راجع PricingEngineService
  --                  للقايمة المسموحة بالتفصيل الكامل، أي عملية برّه القايمة دي ترفض وقت الحفظ.
  payload       JSONB               NOT NULL,
  display_order SMALLINT            NOT NULL DEFAULT 0,
  valid_from    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ         NULL,
  is_active     BOOLEAN             NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ         NULL
);
CREATE INDEX idx_service_pricing_rules_lookup ON service_pricing_rules(service_id, rule_key, valid_from, valid_until)
  WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- سجل كل عملية حساب فعلية — للتدقيق والمراجعة (هل المعادلة بتدي نتايج منطقية؟)، مش للعرض
-- المباشر للعميل. مفيدة كمان كمصدر بيانات لاحق لمحرك التعلّم الذاتي الموجود (service_productivity_actuals)
-- لو قررنا نربطهم يومًا — مفيش ربط تلقائي دلوقتي، القرار ده مؤجل عمدًا (نفس فلسفة عدم اختراع
-- تكامل غير مطلوب صراحة).
CREATE TABLE service_pricing_evaluations (
  id                       UUID           PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id               UUID           NOT NULL REFERENCES services(id),
  order_id                 UUID           NULL REFERENCES orders(id),
  field_values             JSONB          NOT NULL,
  computed_price_cents     INTEGER        NOT NULL,
  computed_duration_days   NUMERIC(6, 2)  NULL,
  computed_technicians     SMALLINT       NULL,
  computed_assistants      SMALLINT       NULL,
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_pricing_evaluations_service_id ON service_pricing_evaluations(service_id);
CREATE INDEX idx_service_pricing_evaluations_order_id ON service_pricing_evaluations(order_id) WHERE order_id IS NOT NULL;
