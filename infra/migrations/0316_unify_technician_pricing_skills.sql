-- مصدر تسعير واحد للفني: مبتدئ / قياسي / خبير.
-- current_level يظل مستوىً تشغيليًا (مطابقة/ترقية/KPI) ولا يملك مضاعف سعر مستقل بعد هذا الترحيل.

-- قبل ضغط الفئات الأربع إلى ثلاث، احتفظ بأعلى إعداد عند وجود أكثر من صف لنفس الفئة النهائية.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY service_id,
        CASE pricing_tier::text
          WHEN 'standard' THEN 'standard'
          WHEN 'expert' THEN 'expert'
          WHEN 'senior' THEN 'expert'
          WHEN 'premium' THEN 'expert'
        END
      ORDER BY
        CASE pricing_tier::text
          WHEN 'premium' THEN 4
          WHEN 'senior' THEN 3
          WHEN 'expert' THEN 2
          WHEN 'standard' THEN 1
        END DESC,
        is_active DESC,
        updated_at DESC,
        id DESC
    ) AS row_number
  FROM service_pricing_tier_pricing
)
DELETE FROM service_pricing_tier_pricing pricing
USING ranked
WHERE pricing.id = ranked.id
  AND ranked.row_number > 1;

ALTER TABLE technician_profiles
  ALTER COLUMN pricing_tier DROP DEFAULT,
  ALTER COLUMN pricing_tier TYPE text USING pricing_tier::text;

ALTER TABLE service_pricing_tier_pricing
  ALTER COLUMN pricing_tier TYPE text USING pricing_tier::text;

ALTER TYPE technician_pricing_tier RENAME TO technician_pricing_tier_legacy;
CREATE TYPE technician_pricing_tier AS ENUM ('beginner', 'standard', 'expert');

ALTER TABLE technician_profiles
  ALTER COLUMN pricing_tier TYPE technician_pricing_tier
  USING (
    CASE pricing_tier
      WHEN 'standard' THEN 'standard'
      WHEN 'expert' THEN 'expert'
      WHEN 'senior' THEN 'expert'
      WHEN 'premium' THEN 'expert'
      ELSE 'standard'
    END
  )::technician_pricing_tier,
  ALTER COLUMN pricing_tier SET DEFAULT 'standard'::technician_pricing_tier;

ALTER TABLE service_pricing_tier_pricing
  ALTER COLUMN pricing_tier TYPE technician_pricing_tier
  USING (
    CASE pricing_tier
      WHEN 'standard' THEN 'standard'
      WHEN 'expert' THEN 'expert'
      WHEN 'senior' THEN 'expert'
      WHEN 'premium' THEN 'expert'
      ELSE 'standard'
    END
  )::technician_pricing_tier;

-- مبتدئ يبدأ من نفس مضاعف القياسي إن لم يحدد الأدمن سعره صراحةً بعد.
INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier, is_active)
SELECT standard.service_id, 'beginner'::technician_pricing_tier, standard.price_multiplier, standard.is_active
FROM service_pricing_tier_pricing standard
WHERE standard.pricing_tier = 'standard'::technician_pricing_tier
  AND NOT EXISTS (
    SELECT 1
    FROM service_pricing_tier_pricing beginner
    WHERE beginner.service_id = standard.service_id
      AND beginner.pricing_tier = 'beginner'::technician_pricing_tier
  );

-- انقل آخر إعدادات المستوى التشغيلي إلى الفئة المناظرة، فقط عندما لا يوجد إعداد موحد لها.
WITH candidates AS (
  SELECT
    service_id,
    CASE technician_level::text
      WHEN 'new' THEN 'beginner'
      WHEN 'verified' THEN 'standard'
      WHEN 'professional' THEN 'standard'
      WHEN 'premium' THEN 'expert'
      WHEN 'team_leader' THEN 'expert'
    END::technician_pricing_tier AS pricing_tier,
    price_multiplier,
    CASE technician_level::text
      WHEN 'team_leader' THEN 5
      WHEN 'premium' THEN 4
      WHEN 'professional' THEN 3
      WHEN 'verified' THEN 2
      WHEN 'new' THEN 1
    END AS source_rank,
    updated_at
  FROM service_level_pricing
  WHERE is_active = true
), selected AS (
  SELECT DISTINCT ON (service_id, pricing_tier)
    service_id, pricing_tier, price_multiplier
  FROM candidates
  ORDER BY service_id, pricing_tier, source_rank DESC, updated_at DESC
)
INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier, is_active)
SELECT selected.service_id, selected.pricing_tier, selected.price_multiplier, true
FROM selected
WHERE NOT EXISTS (
  SELECT 1
  FROM service_pricing_tier_pricing unified
  WHERE unified.service_id = selected.service_id
    AND unified.pricing_tier = selected.pricing_tier
  );

-- الجدول القديم يبقى كسجل تاريخي فقط؛ لا يوجد API أو مسار حساب يمكنه استخدامه بعد اليوم.
UPDATE service_level_pricing
SET is_active = false
WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_pricing_tier_pricing_service_tier
  ON service_pricing_tier_pricing(service_id, pricing_tier);

DROP TYPE technician_pricing_tier_legacy;
