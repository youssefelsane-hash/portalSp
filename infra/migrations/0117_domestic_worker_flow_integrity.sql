-- baytak - 0117: Phase 5 domestic-worker earning and renewal integrity.

ALTER TYPE domestic_worker_earning_approval_status ADD VALUE IF NOT EXISTS 'invalidated';

ALTER TABLE domestic_worker_earning_approvals
  ADD COLUMN source_key VARCHAR(120);

-- Historical rows predate period/source identity. Give every one a stable non-colliding key
-- without guessing which monthly period it represented.
UPDATE domestic_worker_earning_approvals
SET source_key = 'legacy:' || id::text
WHERE source_key IS NULL;

ALTER TABLE domestic_worker_earning_approvals
  ALTER COLUMN source_key SET NOT NULL;

CREATE UNIQUE INDEX uq_dw_earning_approvals_booking_source
  ON domestic_worker_earning_approvals(booking_id, source_key)
  WHERE deleted_at IS NULL;
