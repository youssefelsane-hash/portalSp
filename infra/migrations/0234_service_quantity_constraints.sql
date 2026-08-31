ALTER TABLE services
  ADD COLUMN IF NOT EXISTS quantity_min numeric(10,2),
  ADD COLUMN IF NOT EXISTS quantity_max numeric(10,2),
  ADD COLUMN IF NOT EXISTS quantity_step numeric(10,2),
  ADD COLUMN IF NOT EXISTS quantity_precision smallint NOT NULL DEFAULT 2;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_quantity_constraints_check;
ALTER TABLE services
  ADD CONSTRAINT services_quantity_constraints_check CHECK (
    (quantity_min IS NULL OR quantity_min > 0)
    AND (quantity_max IS NULL OR quantity_max > 0)
    AND (quantity_step IS NULL OR quantity_step > 0)
    AND (quantity_min IS NULL OR quantity_max IS NULL OR quantity_max >= quantity_min)
    AND quantity_precision BETWEEN 0 AND 2
  );
