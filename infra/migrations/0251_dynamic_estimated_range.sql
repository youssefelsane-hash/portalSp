-- baytak (صُنّاع) — 0251: نطاق تقديري **ديناميكي** من السعر المحسوب (بند 10/30، ADR-0063).
--
-- ADR-0063 قال بالنص إن حقول العرض الثابتة (`display_price_min_cents`/`display_price_max_cents`)
-- هي **fallback** بس، وإن النطاق المفروض يتولّد من المحرك. النهاردة الـpreview بيمرّر الحقول
-- الثابتة زي ما هي، يعني خدمة سعرها بيتغيّر حسب المدخلات بتعرض نفس النطاق دايمًا مهما اتغيّر
-- الشغل المطلوب — وده نطاق مضلّل مش تقديري.
--
-- الحل نسبة حوالين السعر المحسوب فعلاً للمدخلات دي. النسبة **مش** حدود قصّ:
-- `min_price_cents`/`max_price_cents` فاضلين قصّ صلب زي ما هما (بند 29 بيمنع إعادة استخدامهم)،
-- والنطاق المعروض بيتحسب **بعد** القصّ فبيفضل جوّه الحدود دايمًا.
--
-- NULL = مفيش نسبة متظبطة → الرجوع للحقول الثابتة بالحرف = صفر تغيير سلوك لأي خدمة قايمة.
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS range_percent_below numeric(5,2),
  ADD COLUMN IF NOT EXISTS range_percent_above numeric(5,2);

ALTER TABLE services DROP CONSTRAINT IF EXISTS chk_services_range_percent_bounds;
ALTER TABLE services
  ADD CONSTRAINT chk_services_range_percent_bounds CHECK (
    -- تحت 100% لأن نطاق بيبدأ من صفر أو أقل مالوش معنى للعميل.
    (range_percent_below IS NULL OR (range_percent_below >= 0 AND range_percent_below < 100))
    AND (range_percent_above IS NULL OR (range_percent_above >= 0 AND range_percent_above <= 500))
    -- الاتنين مع بعض أو ولا واحد: نطاق بنص نسبة بيعرض حد واحد وده مش نطاق.
    AND ((range_percent_below IS NULL) = (range_percent_above IS NULL))
  );

COMMENT ON COLUMN services.range_percent_below IS
  'نسبة النطاق التقديري تحت السعر المحسوب — للعرض بس، بتتطبّق بعد قصّ min/max_price_cents (ADR-0063، بند 10). NULL = استخدم display_price_min/max_cents الثابتين.';
