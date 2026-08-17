-- طلبات العمل الإضافي أدلة مالية/نزاع: لا تُحذف عند الرفض. نحافظ على التوافق مع
-- is_customer_approved القديم ونضيف lifecycle صريحًا لكل بنود batch غير قابل للتحرير عبر API.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS proposal_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_by_user_id UUID REFERENCES users(id);

UPDATE order_items
SET proposal_status = CASE WHEN is_customer_approved THEN 'approved' ELSE 'pending' END
WHERE proposal_status = 'pending' AND is_customer_approved = true;

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS chk_order_items_proposal_status,
  ADD CONSTRAINT chk_order_items_proposal_status
    CHECK (proposal_status IN ('pending', 'approved', 'declined'));

CREATE INDEX IF NOT EXISTS idx_order_items_order_pending_proposal
  ON order_items(order_id, batch_id)
  WHERE proposal_status = 'pending';
