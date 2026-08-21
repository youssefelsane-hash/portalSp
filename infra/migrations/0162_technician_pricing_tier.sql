-- baytak — 0162: فئة تسعير الفني (Standard/Expert/Senior/Premium) — منفصلة عن TechnicianLevel التشغيلي
-- (docs/08 §36.24، ADR-0025). صفر اشتقاق تلقائي من current_level — كل الفنيين 'standard' لحد ما
-- أدمن يصنّفهم صراحة. service_pricing_tier_pricing جدول جديد، مرآة كاملة لـservice_level_pricing
-- الموجود، صفر تعديل عليه.

DO $$ BEGIN
  CREATE TYPE technician_pricing_tier AS ENUM ('standard', 'expert', 'senior', 'premium');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE technician_profiles
  ADD COLUMN IF NOT EXISTS pricing_tier technician_pricing_tier NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS service_pricing_tier_pricing (
  id                  UUID                      PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id          UUID                      NOT NULL REFERENCES services(id),
  pricing_tier        technician_pricing_tier   NOT NULL,
  price_multiplier    NUMERIC(4,2)              NOT NULL,
  is_active           BOOLEAN                   NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ               NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_pricing_tier_pricing_lookup
  ON service_pricing_tier_pricing(service_id, pricing_tier) WHERE is_active = true;
DROP TRIGGER IF EXISTS set_updated_at ON service_pricing_tier_pricing;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_pricing_tier_pricing
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
