-- P1-4: customer history is cursor-paginated by this exact ordering.
CREATE INDEX IF NOT EXISTS idx_orders_customer_created_cursor
  ON orders (customer_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
