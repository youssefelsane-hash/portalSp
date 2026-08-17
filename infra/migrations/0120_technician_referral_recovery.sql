-- baytak - 0120: terminal state for malformed legacy technician-referral wallet effects.

ALTER TABLE technician_referral_bonuses
  DROP CONSTRAINT IF EXISTS technician_referral_bonuses_status_check;

ALTER TABLE technician_referral_bonuses
  ADD CONSTRAINT technician_referral_bonuses_status_check
  CHECK (status IN ('credited', 'revoked', 'rejected_suspicious', 'manual_review'));

COMMENT ON COLUMN technician_referral_bonuses.status IS
  'manual_review terminates automatic recovery when a pre-Phase-4 orphan ledger cannot be paired safely.';
