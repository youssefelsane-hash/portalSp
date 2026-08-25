-- A technician may propose a new visit slot, but the customer remains the
-- decision maker. The request and its decision are durable and auditable even
-- when push delivery is temporarily unavailable.

CREATE TABLE order_reschedule_requests (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  technician_id        UUID NOT NULL REFERENCES technician_profiles(id),
  proposed_slot_id     UUID NOT NULL REFERENCES technician_schedule_slots(id),
  reason               TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  resolved_by_user_id  UUID NULL REFERENCES users(id),
  resolved_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_reschedule_request_resolution CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by_user_id IS NULL)
    OR
    (status <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_order_reschedule_requests_one_pending
  ON order_reschedule_requests(order_id)
  WHERE status = 'pending';

CREATE INDEX idx_order_reschedule_requests_order_created
  ON order_reschedule_requests(order_id, created_at DESC);

CREATE INDEX idx_order_reschedule_requests_technician_created
  ON order_reschedule_requests(technician_id, created_at DESC);

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('orders.technician_reschedule_max_requests', '2', 'number', 'orders',
   'أقصى عدد طلبات تأجيل يستطيع الفني إرسالها لنفس الطلب قبل تدخل الدعم', false)
ON CONFLICT (key) DO NOTHING;
