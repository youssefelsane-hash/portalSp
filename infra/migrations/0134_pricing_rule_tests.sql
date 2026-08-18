-- Script 4 Part L §48 — حالات اختبار محفوظة لمعادلة تسعير خدمة. كانت فجوة موثّقة صراحة:
-- المعاينة الوحيدة الموجودة (evaluate-price) بتقرا القواعد المحفوظة فعليًا بس (الأدمن مضطر
-- يحفظ/ينشر التعديل الأول قبل ما يقدر يعاين نتيجته)، ومفيش أي طريقة يحفظ الأدمن حالة اختبار
-- ("مدخل معيّن لازم ينتج سعر X") يعيد تشغيلها بعد أي تعديل مستقبلي للتأكد إنه ما كسرش حاجة.

CREATE TABLE service_pricing_rule_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id UUID NOT NULL REFERENCES services(id),
  label VARCHAR(160) NOT NULL,
  field_values JSONB NOT NULL,
  expected_price_cents INTEGER NOT NULL,
  created_by_admin_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_pricing_rule_tests_service_id ON service_pricing_rule_tests(service_id);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_pricing_rule_tests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
