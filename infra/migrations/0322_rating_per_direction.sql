-- Allow both sides of a completed order to rate independently.
-- The old UNIQUE(order_id) made the first submitted direction block the other one.
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_order_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ratings_order_direction
  ON ratings(order_id, rating_type);
