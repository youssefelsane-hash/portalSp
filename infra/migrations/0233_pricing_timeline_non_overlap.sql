CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Keep the latest active row when legacy data contains two versions with the exact same start.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY service_id, service_zone_id, valid_from
           ORDER BY updated_at DESC, id DESC
         ) AS row_number
  FROM service_zone_pricing
  WHERE is_active = true
)
UPDATE service_zone_pricing pricing
SET is_active = false
FROM ranked
WHERE pricing.id = ranked.id AND ranked.row_number > 1;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY service_id, rule_type, rule_key, valid_from
           ORDER BY updated_at DESC, id DESC
         ) AS row_number
  FROM service_pricing_rules
  WHERE is_active = true AND deleted_at IS NULL
)
UPDATE service_pricing_rules rule
SET is_active = false
FROM ranked
WHERE rule.id = ranked.id AND ranked.row_number > 1;

-- Repair legacy open-ended future versions into one continuous half-open timeline.
WITH ordered AS (
  SELECT id,
         lead(valid_from) OVER (
           PARTITION BY service_id, service_zone_id
           ORDER BY valid_from, id
         ) AS next_valid_from
  FROM service_zone_pricing
  WHERE is_active = true
)
UPDATE service_zone_pricing pricing
SET valid_until = ordered.next_valid_from
FROM ordered
WHERE pricing.id = ordered.id
  AND pricing.valid_until IS DISTINCT FROM ordered.next_valid_from;

WITH ordered AS (
  SELECT id,
         lead(valid_from) OVER (
           PARTITION BY service_id, rule_type, rule_key
           ORDER BY valid_from, id
         ) AS next_valid_from
  FROM service_pricing_rules
  WHERE is_active = true AND deleted_at IS NULL
)
UPDATE service_pricing_rules rule
SET valid_until = ordered.next_valid_from
FROM ordered
WHERE rule.id = ordered.id
  AND rule.valid_until IS DISTINCT FROM ordered.next_valid_from;

ALTER TABLE service_zone_pricing
  DROP CONSTRAINT IF EXISTS service_zone_pricing_validity_check;
ALTER TABLE service_zone_pricing
  ADD CONSTRAINT service_zone_pricing_validity_check
  CHECK (valid_until IS NULL OR valid_until > valid_from);

ALTER TABLE service_pricing_rules
  DROP CONSTRAINT IF EXISTS service_pricing_rules_validity_check;
ALTER TABLE service_pricing_rules
  ADD CONSTRAINT service_pricing_rules_validity_check
  CHECK (valid_until IS NULL OR valid_until > valid_from);

ALTER TABLE service_zone_pricing
  DROP CONSTRAINT IF EXISTS service_zone_pricing_no_overlap;
ALTER TABLE service_zone_pricing
  ADD CONSTRAINT service_zone_pricing_no_overlap
  EXCLUDE USING gist (
    service_id WITH =,
    service_zone_id WITH =,
    tstzrange(valid_from, COALESCE(valid_until, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (is_active = true);

ALTER TABLE service_pricing_rules
  DROP CONSTRAINT IF EXISTS service_pricing_rules_no_overlap;
ALTER TABLE service_pricing_rules
  ADD CONSTRAINT service_pricing_rules_no_overlap
  EXCLUDE USING gist (
    service_id WITH =,
    rule_type WITH =,
    rule_key WITH =,
    tstzrange(valid_from, COALESCE(valid_until, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (is_active = true AND deleted_at IS NULL);
