-- baytak — 0161: تسعير المنطقة كمُعدِّل نسبي، مع الإبقاء على Override الثابت (docs/08 §36.22-23، ADR-0024)
-- صفر تغيير سلوك للصفوف الموجودة — كلها بتتحدّث لـpricing_mode='override' (السلوك القديم بالحرف).

DO $$ BEGIN
  CREATE TYPE zone_pricing_mode AS ENUM ('override', 'percentage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE service_zone_pricing
  ADD COLUMN IF NOT EXISTS pricing_mode zone_pricing_mode NOT NULL DEFAULT 'override',
  ADD COLUMN IF NOT EXISTS modifier_percentage NUMERIC(6,2) NULL;

ALTER TABLE service_zone_pricing ALTER COLUMN price_cents DROP NOT NULL;

ALTER TABLE service_zone_pricing DROP CONSTRAINT IF EXISTS zone_pricing_mode_fields_check;
ALTER TABLE service_zone_pricing ADD CONSTRAINT zone_pricing_mode_fields_check CHECK (
  (pricing_mode = 'override' AND price_cents IS NOT NULL AND modifier_percentage IS NULL)
  OR
  (pricing_mode = 'percentage' AND modifier_percentage IS NOT NULL AND price_cents IS NULL)
);
