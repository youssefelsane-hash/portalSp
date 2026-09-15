-- Platform-funded discounts can produce a negative platform settlement bucket while every
-- technician share remains positive. Refund snapshots must preserve that signed platform amount
-- so partial refunds telescope to the exact original settlement.

ALTER TABLE refund_settlement_reversals
  DROP CONSTRAINT IF EXISTS refund_settlement_reversals_original_bucket_cents_check,
  DROP CONSTRAINT IF EXISTS refund_settlement_reversals_reversal_cents_check;

ALTER TABLE refund_settlement_reversals
  ADD CONSTRAINT refund_settlement_reversals_original_bucket_cents_check
    CHECK (bucket_type = 'platform' OR original_bucket_cents >= 0),
  ADD CONSTRAINT refund_settlement_reversals_reversal_cents_check
    CHECK (bucket_type = 'platform' OR reversal_cents >= 0);

COMMENT ON COLUMN refund_settlement_reversals.original_bucket_cents IS
  'Signed for the platform bucket when the platform funds a discount; participant buckets stay non-negative.';
COMMENT ON COLUMN refund_settlement_reversals.reversal_cents IS
  'Signed for the platform bucket so cumulative partial refunds exactly reverse subsidized settlements.';
