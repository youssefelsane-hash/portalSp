-- baytak — 0009: التقييم والشكاوى والدعم والشات والإشعارات
-- مرجع: docs/02-data-dictionary.md §8, §9

CREATE TABLE ratings (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                  UUID          NOT NULL UNIQUE REFERENCES orders(id),
  rated_by_user_id          UUID          NOT NULL REFERENCES users(id),
  rated_user_id             UUID          NOT NULL REFERENCES users(id),
  rating_type               rating_type   NOT NULL,
  overall_rating            SMALLINT      NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  punctuality_rating        SMALLINT      NULL CHECK (punctuality_rating BETWEEN 1 AND 5),
  quality_rating            SMALLINT      NULL CHECK (quality_rating BETWEEN 1 AND 5),
  professionalism_rating    SMALLINT      NULL CHECK (professionalism_rating BETWEEN 1 AND 5),
  price_fairness_rating     SMALLINT      NULL CHECK (price_fairness_rating BETWEEN 1 AND 5),
  comment                   TEXT          NULL,
  tags                      TEXT[]        NULL,   -- ['ملتزم','نضيف','شرح كويس']
  is_published               BOOLEAN      NOT NULL DEFAULT true,
  is_flagged                 BOOLEAN      NOT NULL DEFAULT false,
  flagged_reason             TEXT         NULL,
  moderated_by_user_id      UUID          NULL REFERENCES users(id),
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_ratings_rated_user_id ON ratings(rated_user_id);

CREATE TABLE complaints (
  id                      UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  complaint_number        VARCHAR(24)                 NOT NULL UNIQUE,   -- CMP-2026-000123
  order_id                UUID                        NULL REFERENCES orders(id),
  filed_by_user_id        UUID                        NOT NULL REFERENCES users(id),
  against_user_id         UUID                        NULL REFERENCES users(id),
  category                complaint_category          NOT NULL,
  severity                complaint_severity          NOT NULL DEFAULT 'medium',
  title                   VARCHAR(200)                NOT NULL,
  description             TEXT                        NOT NULL,
  complaint_status        complaint_status            NOT NULL DEFAULT 'open',
  resolution_type         complaint_resolution_type   NULL,
  resolution_notes        TEXT                        NULL,
  compensation_cents      INTEGER                     NOT NULL DEFAULT 0,
  assigned_to_user_id     UUID                        NULL REFERENCES users(id),
  sla_due_at              TIMESTAMPTZ                 NOT NULL,
  first_response_at        TIMESTAMPTZ                NULL,
  resolved_at             TIMESTAMPTZ                 NULL,
  resolved_by_user_id     UUID                        NULL REFERENCES users(id),
  customer_satisfied      BOOLEAN                     NULL,
  created_at              TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ                 NOT NULL DEFAULT now()
);
CREATE INDEX idx_complaints_order_id ON complaints(order_id);
CREATE INDEX idx_complaints_status ON complaints(complaint_status);
CREATE INDEX idx_complaints_against_user_id ON complaints(against_user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON complaints
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE complaint_messages (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  complaint_id          UUID          NOT NULL REFERENCES complaints(id),
  sender_user_id        UUID          NOT NULL REFERENCES users(id),
  sender_role           VARCHAR(40)   NOT NULL,
  message                TEXT         NOT NULL,
  is_internal_note      BOOLEAN       NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_complaint_messages_complaint_id ON complaint_messages(complaint_id);

CREATE TABLE complaint_attachments (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  complaint_id          UUID          NOT NULL REFERENCES complaints(id),
  file_url              TEXT          NOT NULL,
  file_type             VARCHAR(40)   NULL,
  uploaded_by_user_id   UUID          NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_complaint_attachments_complaint_id ON complaint_attachments(complaint_id);

CREATE TABLE support_tickets (
  id                      UUID                    PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_number           VARCHAR(24)             NOT NULL UNIQUE,
  user_id                 UUID                    NOT NULL REFERENCES users(id),
  subject                 VARCHAR(200)            NOT NULL,
  category                VARCHAR(60)             NOT NULL,
  priority                support_ticket_priority NOT NULL DEFAULT 'medium',
  ticket_status           support_ticket_status   NOT NULL DEFAULT 'open',
  channel                 support_channel         NOT NULL,
  assigned_to_user_id     UUID                    NULL REFERENCES users(id),
  first_response_at        TIMESTAMPTZ            NULL,
  resolved_at             TIMESTAMPTZ             NULL,
  satisfaction_rating     SMALLINT                NULL CHECK (satisfaction_rating BETWEEN 1 AND 5),
  created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ             NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(ticket_status);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE chat_threads (
  id                    UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id              UUID              NULL UNIQUE REFERENCES orders(id),
  thread_type           chat_thread_type  NOT NULL,
  customer_id           UUID              NOT NULL REFERENCES customer_profiles(id),
  technician_id         UUID              NULL REFERENCES technician_profiles(id),
  is_active             BOOLEAN           NOT NULL DEFAULT true,
  last_message_at       TIMESTAMPTZ       NULL,
  closes_at             TIMESTAMPTZ       NULL,   -- يقفل 24 ساعة بعد إنهاء الطلب
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_threads_customer_id ON chat_threads(customer_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON chat_threads
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- is_flagged ضروري: أكبر تسريب للفنيين خارج المنصة بيحصل من تبادل الأرقام في الشات (§14 في القاموس)
CREATE TABLE chat_messages (
  id                UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  thread_id         UUID                NOT NULL REFERENCES chat_threads(id),
  sender_user_id    UUID                NOT NULL REFERENCES users(id),
  message_type      chat_message_type   NOT NULL,
  content           TEXT                NULL,
  file_url          TEXT                NULL,
  location           GEOGRAPHY(POINT)   NULL,
  is_read           BOOLEAN             NOT NULL DEFAULT false,
  read_at           TIMESTAMPTZ         NULL,
  is_flagged        BOOLEAN             NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX idx_chat_messages_flagged ON chat_messages(is_flagged) WHERE is_flagged = true;

CREATE TABLE notifications (
  id                    UUID                          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id               UUID                          NOT NULL REFERENCES users(id),
  notification_type     VARCHAR(60)                   NOT NULL,   -- order_accepted | technician_arrived | payment_received ...
  channel               notification_channel          NOT NULL,
  title_ar              VARCHAR(160)                  NOT NULL,
  body_ar               TEXT                          NOT NULL,
  deep_link             VARCHAR(255)                  NULL,
  reference_type        VARCHAR(40)                   NULL,
  reference_id          UUID                          NULL,
  delivery_status       notification_delivery_status  NOT NULL DEFAULT 'queued',
  sent_at               TIMESTAMPTZ                   NULL,
  delivered_at          TIMESTAMPTZ                   NULL,
  read_at               TIMESTAMPTZ                   NULL,
  failure_reason        TEXT                          NULL,
  created_at            TIMESTAMPTZ                   NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_id ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_delivery_status ON notifications(delivery_status);

CREATE TABLE user_devices (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID              NOT NULL REFERENCES users(id),
  device_id         VARCHAR(128)      NOT NULL UNIQUE,
  fcm_token         TEXT              NULL,
  platform          device_platform   NOT NULL,
  os_version        VARCHAR(40)       NULL,
  app_version       VARCHAR(20)       NULL,
  device_model      VARCHAR(80)       NULL,
  is_active         BOOLEAN           NOT NULL DEFAULT true,
  last_active_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_devices_user_id ON user_devices(user_id) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON user_devices
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
