-- Manual reconciliation must preserve who verified the external outcome and the evidence used.
ALTER TABLE refunds ADD COLUMN reconciled_by_user_id UUID NULL REFERENCES users(id);
ALTER TABLE refunds ADD COLUMN reconciled_at TIMESTAMPTZ NULL;
ALTER TABLE refunds ADD COLUMN reconciliation_evidence TEXT NULL;
