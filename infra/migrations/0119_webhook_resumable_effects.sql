-- baytak - 0119: explicit exhausted webhook state and resumable post-commit effects

ALTER TYPE webhook_processing_status
  ADD VALUE IF NOT EXISTS 'manual_review';

ALTER TABLE webhook_events
  ADD COLUMN processing_stage VARCHAR(20) NOT NULL DEFAULT 'financial',
  ADD COLUMN effects_payload JSONB NULL,
  ADD COLUMN effects_delivered_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT chk_webhook_events_processing_stage
    CHECK (processing_stage IN ('financial', 'effects'));

COMMENT ON COLUMN webhook_events.processing_stage IS
  'financial processes provider truth; effects resumes only post-commit downstream delivery';
COMMENT ON COLUMN webhook_events.effects_payload IS
  'durable payment-confirmed effect input committed atomically with financial state';
