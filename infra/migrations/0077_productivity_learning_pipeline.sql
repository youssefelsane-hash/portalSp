-- baytak — 0077: محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — كانت فجوة موثّقة صراحة:
-- "تسجيل يدوي فقط، لسه مش مربوطة تلقائيًا بالطلبات... مفيش automatic learning من completed
-- orders ولا suggested standard update". المرحلة دي بتقفل الفجوة كاملة: observation تلقائي عند
-- إكمال طلب حقيقي → aggregate (median) → اقتراح → موافقة/رفض الأدمن الصريحة.

-- الوحدات المطلوبة الفعلية وقت الحجز (requested_units، من CreateOrderDto) كانت بتتحسب بس مش
-- بتتخزن على الطلب نفسه — من غيرها مفيش طريقة نعرف "كام وحدة اتعملت فعلاً" وقت الإكمال عشان
-- نسجّل observation دقيق تلقائي.
ALTER TABLE orders ADD COLUMN requested_units NUMERIC(10,2) NULL;
COMMENT ON COLUMN orders.requested_units IS 'الوحدات المطلوبة وقت الحجز (م٬ قطعة٬ إلخ) لخدمات standard_data_id — بتتسجّل هنا عشان تُستخدم كـactual_units وقت التقاط observation تلقائي عند الإكمال (محرك الإنتاجية الذاتي التعلّم).';

-- source بيفرّق observation اتسجّل تلقائيًا عند إكمال طلب حقيقي (system_auto) عن تسجيل يدوي من
-- الأدمن (manual، كان الوحيد المدعوم قبل كده). الاقتراحات (تحت) بتعتمد بس على system_auto.
ALTER TABLE service_productivity_actuals ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'system_auto'));
COMMENT ON COLUMN service_productivity_actuals.source IS 'system_auto = اتسجّل تلقائيًا عند إكمال طلب حقيقي مربوط بـstandard_data_id، manual = تسجيل يدوي من الأدمن (السلوك الأصلي).';

-- الاقتراح نفسه — median القيم المُطبّعة (normalized على أساس min_technicians) لعدد كافٍ من
-- observations حديثة، بانتظار موافقة/رفض الأدمن. مفيش تحديث تلقائي لـproductivity_per_day بلا
-- موافقة صريحة — "suggestion → admin approve"، مش "auto-apply".
CREATE TABLE service_productivity_suggestions (
  id                              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_standard_data_id        UUID          NOT NULL REFERENCES service_standard_data(id),
  current_productivity_per_day    NUMERIC(10,2) NOT NULL,
  suggested_productivity_per_day  NUMERIC(10,2) NOT NULL,
  sample_size                     INTEGER       NOT NULL,
  confidence_score                NUMERIC(4,3)  NOT NULL,
  status                          VARCHAR(20)   NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  reviewed_at                     TIMESTAMPTZ   NULL,
  reviewed_by_user_id             UUID          NULL REFERENCES users(id)
);

CREATE INDEX idx_service_productivity_suggestions_pending
  ON service_productivity_suggestions(service_standard_data_id, status);

COMMENT ON TABLE service_productivity_suggestions IS 'اقتراح تحديث productivity_per_day من محرك الإنتاجية الذاتي التعلّم (median لـobservations حقيقية) — بانتظار موافقة/رفض الأدمن، مفيش تطبيق تلقائي.';
COMMENT ON COLUMN service_productivity_suggestions.confidence_score IS 'من 0 لـ1 — مبني على حجم العينة وثبات القيم (تباين أقل = ثقة أعلى). استرشادي للأدمن، مش قرار آلي.';

-- إعدادات قابلة للتعديل من /settings — نفس فلسفة أي عتبة تانية في المشروع.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('productivity_learning.min_sample_size', '5', 'number', 'productivity_learning', 'أقل عدد observations قبل ما نولّد اقتراح تحديث إنتاجية', false),
  ('productivity_learning.min_change_percentage', '5', 'number', 'productivity_learning', 'أقل نسبة فرق بين الإنتاجية الحالية والمقترحة عشان نولّد اقتراح (تفادي اقتراحات تافهة)', false);
