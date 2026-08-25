-- Preserve the exact quantity that drove per-unit pricing on both ordinary and
-- recurring orders. This is distinct from requested_units, which drives crew
-- productivity estimates and may use a different measurement.

ALTER TABLE orders
  ADD COLUMN pricing_quantity NUMERIC(10,2) NULL;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_pricing_quantity_positive
  CHECK (pricing_quantity IS NULL OR pricing_quantity > 0);

ALTER TABLE recurring_order_templates
  ADD COLUMN pricing_quantity NUMERIC(10,2) NULL;

ALTER TABLE recurring_order_templates
  ADD CONSTRAINT chk_recurring_order_templates_pricing_quantity_positive
  CHECK (pricing_quantity IS NULL OR pricing_quantity > 0);
