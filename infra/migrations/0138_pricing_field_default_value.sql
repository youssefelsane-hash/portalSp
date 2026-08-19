-- Script 6 (SONNA3_Customer_Booking_UX...) Part 3/4 — بَقّة حقيقية حية اتلقطت: حقل CHECKBOX
-- اختياري (زي has_bathtub) بلا قيمة افتراضية معمارية خالص. لو العميل ما لمسوش، الفرونت ما كانش
-- بيبعته في field_values، وPricingEngineService.validateAndNormalizeFieldValues() كانت
-- بتتجاهله (continue) بدل ما تدّيله قيمة افتراضية — فلما المعادلة تحاول تقرأه (field_ref أو شرط)
-- evaluateFormulaNode()/evaluateCondition() كانوا بيرفضوا بـ400 "الحقل مطلوب لحساب السعر"، رغم
-- إن الحقل نفسه isRequired=false. تفاصيل الإصلاح الكامل في pricing-engine.service.ts.
ALTER TABLE service_pricing_fields ADD COLUMN default_value TEXT NULL;

COMMENT ON COLUMN service_pricing_fields.default_value IS
  'قيمة افتراضية اختيارية (نص خام، بيتفسّر حسب field_type وقت الاستخدام) بتتطبق لو العميل ما لمسش الحقل وهو مش إجباري. لحقول CHECKBOX بلا default_value صريح، الافتراض الضمني false (سلوك checkbox قياسي).';
