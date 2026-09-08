-- Durable delivery for recurring cash reminders. The order is marked sent only after delivery.
CREATE TABLE recurring_notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  event_type VARCHAR(80) NOT NULL,
  order_id UUID NOT NULL REFERENCES orders(id),
  customer_profile_id UUID NOT NULL REFERENCES customer_profiles(id),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'discarded', 'manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recurring_notification_outbox_event UNIQUE (event_type, order_id)
);

CREATE INDEX idx_recurring_notification_outbox_recovery
  ON recurring_notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');
