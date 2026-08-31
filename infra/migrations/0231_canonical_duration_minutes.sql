-- Expand/backfill/switch: minutes preserve 90-minute bookings without floating-point hours.
-- duration_hours stays during the compatibility window and can be removed only after old clients retire.
ALTER TABLE orders ADD COLUMN duration_minutes INTEGER NULL;
ALTER TABLE recurring_order_templates ADD COLUMN duration_minutes INTEGER NULL;

UPDATE orders
SET duration_minutes = duration_hours * 60
WHERE duration_minutes IS NULL AND duration_hours IS NOT NULL;

UPDATE recurring_order_templates
SET duration_minutes = duration_hours * 60
WHERE duration_minutes IS NULL AND duration_hours IS NOT NULL;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_duration_minutes_positive
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);

ALTER TABLE recurring_order_templates
  ADD CONSTRAINT chk_recurring_templates_duration_minutes_positive
  CHECK (duration_minutes IS NULL OR duration_minutes > 0);
