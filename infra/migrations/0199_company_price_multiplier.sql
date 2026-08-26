-- baytak - 0199: ADR-0042 / docs/08 §64.و — معامل سعر خاص بكل شركة فنيين.
--
-- طلب المالك: «الشركات مالهاش معاملات زيادة، الشركة دايمًا بالسعر الأساسي… عايزين جوا كل شركة
-- يكون فيه معامل زيادة خاص بيها». حجز الشركة مالوش مستوى فني (docs/08 §62.2) فخانة مضاعف
-- المستوى بتفضل فاضية = 1 دايمًا، يعني مفيش أي وسيلة تسعّر شركة أعلى من الأساسي.
--
-- الافتراضي 1.00 = صفر تغيير سلوك للبيانات الموجودة، ومفيش backfill مطلوب.
-- الحد الأدنى 1.00 عمدًا: المعامل بيزوّد بس — التخفيض أداة تانية (خصومات/بروموكود) وخلطه هنا
-- بيخفي الخسارة جوّه السعر.
ALTER TABLE technician_companies
  ADD COLUMN IF NOT EXISTS price_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00;

ALTER TABLE technician_companies
  DROP CONSTRAINT IF EXISTS technician_companies_price_multiplier_range;

ALTER TABLE technician_companies
  ADD CONSTRAINT technician_companies_price_multiplier_range
  CHECK (price_multiplier >= 1.00 AND price_multiplier <= 3.00);

COMMENT ON COLUMN technician_companies.price_multiplier IS
  'ADR-0042: مضاعف سعر الشغل لحجوزات الشركة دي. بيحل محل مضاعف مستوى/فئة الفني (مش فوقه) لأن حجز الشركة مالوش مستوى. تحكم أدمن فقط.';
