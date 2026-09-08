-- Durable, idempotent delivery for financial customer notifications. A completed financial
-- transaction writes this row in the same DB transaction; delivery is retried separately.
CREATE TABLE payment_notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_type VARCHAR(80) NOT NULL,
  aggregate_id UUID NOT NULL,
  order_id UUID NOT NULL REFERENCES orders(id),
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_notification_outbox_event UNIQUE (event_type, aggregate_id)
);

CREATE INDEX idx_payment_notification_outbox_recovery
  ON payment_notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE notifications ADD COLUMN source_delivery_key VARCHAR(140) NULL;
CREATE UNIQUE INDEX uq_notifications_source_delivery_key
  ON notifications (source_delivery_key, user_id, channel)
  WHERE source_delivery_key IS NOT NULL;
