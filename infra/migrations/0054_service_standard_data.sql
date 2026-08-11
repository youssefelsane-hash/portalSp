-- baytak (صُنّاع) — 0054: بيانات قياسية للخدمات + محرك الإنتاجية (docs/06 §3.1-§3.6، docs/07 الجزء ج)
-- لكل خدمة (محارة، سيراميك، سباكة...) ممكن يكون ليها أكتر من "نوع تنفيذ" بإنتاجية مختلفة (محارة
-- داخلي/خارجي/أسقف/تجهيز بؤج مثلاً) — نفس نمط service_zone_pricing/service_addons بالحرف: صفوف
-- متعددة لكل خدمة، مش عمود واحد على services نفسها. execution_type_ar = 'عام' افتراضياً للخدمات
-- اللي مالهاش أنواع تنفيذ فرعية (زي أغلب الخدمات البسيطة).
-- الأرقام المزروعة تحت (لو حصلت) هتبقى seed تجريبي واضح المصدر، مش قيم نهائية — القاعدة الحاكمة
-- في CLAUDE.md: "مفيش اختراع أرقام عمل من غير أساس". الجدول ده فاضي عمداً هنا؛ الزرع (لو حصل)
-- هيكون migration منفصلة موثّقة بوضوح إنها "قيم تجريبية من فيديو مرجعي، قابلة للتعديل الكامل".
CREATE TABLE service_standard_data (
  id                          UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id                  UUID          NOT NULL REFERENCES services(id),
  execution_type_ar           VARCHAR(80)   NOT NULL DEFAULT 'عام',
  unit_ar                     VARCHAR(20)   NOT NULL,
  technician_daily_wage_cents INTEGER       NOT NULL,
  assistant_daily_wage_cents  INTEGER       NULL,
  -- كام وحدة (بالـunit_ar فوق) بينتجها الصنايعي الواحد (+ مساعد أساسي واحد لو الخدمة محتاجة) في
  -- اليوم — أساس محرك الإنتاجية (docs/06 §3.3): المدة = المساحة المطلوبة ÷ الإنتاجية دي، معدّلة
  -- بنسبة عدد العمالة الفعلي المُعيَّن (catalog/README.md بيوثّق الصيغة بالتفصيل).
  productivity_per_day        NUMERIC(10,2) NOT NULL,
  min_technicians              SMALLINT      NOT NULL DEFAULT 1,
  min_assistants               SMALLINT      NOT NULL DEFAULT 0,
  is_active                    BOOLEAN       NOT NULL DEFAULT true,
  display_order                SMALLINT      NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ   NULL
);
CREATE INDEX idx_service_standard_data_service_id ON service_standard_data(service_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_standard_data
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
