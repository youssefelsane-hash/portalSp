-- Script 2 / Phase C: support bounded reconciliation of searching orders whose
-- initial dispatch event or expiry job was lost after the order commit.
CREATE INDEX idx_order_assignments_live_dispatch
  ON order_assignments (order_id, expires_at)
  WHERE assignment_status IN ('sent', 'viewed');

