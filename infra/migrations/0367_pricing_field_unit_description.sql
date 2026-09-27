-- Allow the existing optional unit_ar field to hold a short customer-facing explanation.
-- No new column or pricing behavior is introduced.
ALTER TABLE service_pricing_fields
  ALTER COLUMN unit_ar TYPE VARCHAR(200);
