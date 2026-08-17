-- Script 2 / Phase D: make recurring-order generation safe across API replicas.
-- The occurrence row is the durable job and the unique order identity closes the
-- crash window between committing an order and acknowledging the occurrence.
CREATE TABLE recurring_order_occurrences (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  template_id       UUID        NOT NULL REFERENCES recurring_order_templates(id),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  status            VARCHAR(24) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'failed', 'completed', 'manual_review', 'cancelled')),
  attempt_count     INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at        TIMESTAMPTZ NULL,
  completed_at      TIMESTAMPTZ NULL,
  order_id          UUID        NULL REFERENCES orders(id),
  last_error        TEXT        NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_recurring_order_occurrence UNIQUE (template_id, scheduled_for)
);

CREATE INDEX idx_recurring_order_occurrences_claim
  ON recurring_order_occurrences (next_attempt_at, scheduled_for)
  WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX idx_recurring_order_occurrences_manual_review
  ON recurring_order_occurrences (updated_at)
  WHERE status = 'manual_review';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON recurring_order_occurrences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE orders
  ADD COLUMN recurring_template_id UUID NULL REFERENCES recurring_order_templates(id),
  ADD COLUMN recurring_occurrence_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT chk_orders_recurring_identity_pair
    CHECK ((recurring_template_id IS NULL) = (recurring_occurrence_at IS NULL));

CREATE UNIQUE INDEX uq_orders_recurring_occurrence
  ON orders (recurring_template_id, recurring_occurrence_at)
  WHERE recurring_template_id IS NOT NULL;

