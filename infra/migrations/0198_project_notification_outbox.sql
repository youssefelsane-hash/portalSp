-- baytak - 0198: durable, idempotent project action notifications.

CREATE TABLE project_notification_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id UUID NOT NULL REFERENCES projects(id),
  action VARCHAR(80) NOT NULL,
  actor_user_id UUID NULL REFERENCES users(id),
  actor_role VARCHAR(20) NOT NULL CHECK (actor_role IN ('admin', 'customer', 'system')),
  details JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'manual_review')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_notification_outbox_recovery
  ON project_notification_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE notifications ADD COLUMN source_outbox_id UUID NULL REFERENCES project_notification_outbox(id);
CREATE UNIQUE INDEX uq_notifications_source_outbox_delivery
  ON notifications (source_outbox_id, user_id, channel)
  WHERE source_outbox_id IS NOT NULL;

