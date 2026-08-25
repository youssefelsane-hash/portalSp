-- Before 0183, per-unit services were always priced as one implicit unit. Keep
-- those historical orders explainable and existing recurring plans runnable.

UPDATE orders o
SET pricing_quantity = 1
FROM services s
WHERE s.id = o.service_id
  AND s.pricing_model = 'per_unit'
  AND o.pricing_quantity IS NULL;

UPDATE recurring_order_templates t
SET pricing_quantity = 1
FROM services s
WHERE s.id = t.service_id
  AND s.pricing_model = 'per_unit'
  AND t.pricing_quantity IS NULL;
