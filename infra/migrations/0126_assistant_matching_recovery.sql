-- Script 2 / Phase C: make assistant matching replay-safe and support bounded
-- recovery of a lost order-accepted event or expiry job.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY order_id, assistant_technician_id
           ORDER BY CASE offer_status
             WHEN 'accepted' THEN 0
             WHEN 'sent' THEN 1
             WHEN 'rejected' THEN 2
             WHEN 'expired' THEN 3
             ELSE 4
           END,
           created_at,
           id
         ) AS duplicate_rank
  FROM order_assistant_offers
)
DELETE FROM order_assistant_offers offer
USING ranked
WHERE offer.id = ranked.id AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX uq_order_assistant_offers_logical_recipient
  ON order_assistant_offers (order_id, assistant_technician_id);

CREATE INDEX idx_order_assistant_offers_expiry_recovery
  ON order_assistant_offers (expires_at, order_id)
  WHERE offer_status = 'sent';

