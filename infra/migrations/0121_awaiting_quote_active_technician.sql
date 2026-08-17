-- baytak - 0121: a technician remains busy while an in-progress quote awaits customer approval.

-- Build the stronger invariant before removing the old index. If legacy conflicts exist, this
-- statement fails safely and leaves the 0118 protection in place for the original status set.
CREATE UNIQUE INDEX uq_orders_one_active_per_technician_v2
  ON orders(technician_id)
  WHERE technician_id IS NOT NULL
    AND deleted_at IS NULL
    AND order_status IN (
      'accepted',
      'technician_on_way',
      'technician_arrived',
      'in_progress',
      'awaiting_quote_approval'
    );

DROP INDEX uq_orders_one_active_per_technician;
ALTER INDEX uq_orders_one_active_per_technician_v2
  RENAME TO uq_orders_one_active_per_technician;
