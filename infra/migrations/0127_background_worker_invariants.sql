-- Script 2 / Phase C-D: unique logical work identities used by multi-instance
-- productivity reconciliation workers.
CREATE UNIQUE INDEX uq_productivity_actuals_system_order
  ON service_productivity_actuals (order_id)
  WHERE source = 'system_auto' AND order_id IS NOT NULL;

CREATE UNIQUE INDEX uq_productivity_suggestions_one_pending
  ON service_productivity_suggestions (service_standard_data_id)
  WHERE status = 'pending';

CREATE INDEX idx_orders_productivity_actual_recovery
  ON orders (closed_at, id)
  WHERE order_status = 'completed'
    AND standard_data_id IS NOT NULL
    AND requested_units IS NOT NULL;

