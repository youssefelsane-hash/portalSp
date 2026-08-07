-- baytak — 0007: الطلبات — القلب
-- مرجع: docs/02-data-dictionary.md §6
-- ملاحظة حاكمة: أي انتقال حالة غير مسموح يتقفل في كود الـ state machine (apps/api/modules/orders)،
-- مش في الداتابيز — الجدول ده بيسجل الحالة بس، مش بيفرض الانتقال.

CREATE TABLE cancellation_reasons (
  id                          UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  reason_ar                   VARCHAR(200)                NOT NULL,
  reason_en                   VARCHAR(200)                NOT NULL,
  applies_to                  cancellation_applies_to      NOT NULL,
  charges_fee                 BOOLEAN                     NOT NULL DEFAULT false,
  fee_percentage              NUMERIC(5,2)                NOT NULL DEFAULT 0,
  affects_technician_score    BOOLEAN                     NOT NULL DEFAULT false,
  display_order               SMALLINT                    NOT NULL DEFAULT 0,
  is_active                   BOOLEAN                     NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ                 NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cancellation_reasons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE orders (
  id                              UUID                    PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_number                    VARCHAR(24)             NOT NULL UNIQUE,   -- ORD-2026-000123
  customer_id                     UUID                    NOT NULL REFERENCES customer_profiles(id),
  technician_id                   UUID                    NULL REFERENCES technician_profiles(id),
  service_id                      UUID                    NOT NULL REFERENCES services(id),
  address_id                      UUID                    NOT NULL REFERENCES addresses(id),
  service_zone_id                 UUID                    NULL REFERENCES service_zones(id),
  order_type                      order_type              NOT NULL DEFAULT 'standard',
  order_status                    order_status            NOT NULL DEFAULT 'draft',
  requested_level                 technician_level        NULL,
  problem_description              TEXT                   NULL,
  customer_notes                  TEXT                    NULL,
  scheduled_at                    TIMESTAMPTZ             NULL,
  scheduled_slot_start            TIMESTAMPTZ             NULL,
  scheduled_slot_end              TIMESTAMPTZ             NULL,

  -- التسعير (كله بالقرش)
  estimated_price_cents           INTEGER                 NULL,
  inspection_fee_cents            INTEGER                 NOT NULL DEFAULT 0,
  labor_amount_cents              INTEGER                 NOT NULL DEFAULT 0,
  parts_amount_cents              INTEGER                 NOT NULL DEFAULT 0,
  addons_amount_cents             INTEGER                 NOT NULL DEFAULT 0,
  surge_amount_cents              INTEGER                 NOT NULL DEFAULT 0,
  discount_amount_cents           INTEGER                 NOT NULL DEFAULT 0,
  tax_amount_cents                INTEGER                 NOT NULL DEFAULT 0,
  subtotal_cents                  INTEGER                 NOT NULL DEFAULT 0,
  total_amount_cents              INTEGER                 NOT NULL DEFAULT 0,
  platform_commission_cents       INTEGER                 NOT NULL DEFAULT 0,
  technician_earning_cents        INTEGER                 NOT NULL DEFAULT 0,
  commission_rate_applied         NUMERIC(5,2)            NULL,

  payment_method                  payment_method          NULL,
  payment_status                  order_payment_status    NOT NULL DEFAULT 'unpaid',
  promo_code_id                   UUID                    NULL,   -- FK يتضاف في 0010_promotions.sql

  -- الأوقات (تسلسل دورة الحياة)
  placed_at                       TIMESTAMPTZ             NULL,
  assigned_at                     TIMESTAMPTZ             NULL,
  accepted_at                     TIMESTAMPTZ             NULL,
  technician_departed_at          TIMESTAMPTZ             NULL,
  technician_arrived_at           TIMESTAMPTZ             NULL,
  work_started_at                 TIMESTAMPTZ             NULL,
  work_completed_at               TIMESTAMPTZ             NULL,
  paid_at                         TIMESTAMPTZ             NULL,
  closed_at                       TIMESTAMPTZ             NULL,
  cancelled_at                    TIMESTAMPTZ             NULL,

  cancelled_by_user_id            UUID                    NULL REFERENCES users(id),
  cancellation_reason_id          UUID                    NULL REFERENCES cancellation_reasons(id),
  cancellation_fee_cents          INTEGER                 NOT NULL DEFAULT 0,

  -- القياس
  eta_minutes                     SMALLINT                NULL,
  actual_arrival_delay_minutes    SMALLINT                NULL,
  actual_duration_minutes         SMALLINT                NULL,
  distance_km                     NUMERIC(6,2)            NULL,
  was_on_time                     BOOLEAN                 NULL,
  warranty_expires_at             TIMESTAMPTZ             NULL,
  has_complaint                   BOOLEAN                 NOT NULL DEFAULT false,
  is_reopened                     BOOLEAN                 NOT NULL DEFAULT false,
  parent_order_id                 UUID                    NULL REFERENCES orders(id),
  source_channel                  order_source_channel    NULL,
  metadata                        JSONB                   NOT NULL DEFAULT '{}',
  created_at                      TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ             NOT NULL DEFAULT now(),
  deleted_at                      TIMESTAMPTZ             NULL
);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_customer_id ON orders(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_technician_id ON orders(technician_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_order_status ON orders(order_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_zone_status ON orders(service_zone_id, order_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE order_status_history (
  id                    UUID                  PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id              UUID                  NOT NULL REFERENCES orders(id),
  previous_status       order_status          NULL,
  new_status            order_status          NOT NULL,
  changed_by_user_id    UUID                  NULL REFERENCES users(id),
  changed_by_role       VARCHAR(40)           NULL,
  change_source         order_change_source   NOT NULL,
  reason                TEXT                  NULL,
  location               GEOGRAPHY(POINT)     NULL,
  metadata              JSONB                 NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ          NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_status_history_order_id ON order_status_history(order_id);

CREATE TABLE order_items (
  id                      UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                UUID              NOT NULL REFERENCES orders(id),
  item_type               order_item_type   NOT NULL,
  reference_id             UUID             NULL,
  name_ar                 VARCHAR(160)      NOT NULL,
  description              TEXT             NULL,
  quantity                NUMERIC(8,2)      NOT NULL DEFAULT 1,
  unit_name                VARCHAR(40)      NULL,
  unit_price_cents        INTEGER           NOT NULL,
  total_price_cents       INTEGER           NOT NULL,
  is_customer_approved     BOOLEAN          NOT NULL DEFAULT false,
  approved_at              TIMESTAMPTZ      NULL,
  added_by_user_id        UUID              NOT NULL REFERENCES users(id),
  receipt_photo_url       TEXT              NULL,
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE order_media (
  id                    UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id              UUID              NOT NULL REFERENCES orders(id),
  uploaded_by_user_id   UUID              NOT NULL REFERENCES users(id),
  media_type            order_media_type  NOT NULL,
  file_url              TEXT              NOT NULL,
  thumbnail_url         TEXT              NULL,
  file_size_bytes       INTEGER           NULL,
  caption               VARCHAR(255)      NULL,
  taken_at              TIMESTAMPTZ       NOT NULL DEFAULT now(),
  location               GEOGRAPHY(POINT) NULL,
  created_at             TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_media_order_id ON order_media(order_id);

-- محاولات التوزيع — منجم ذهب للتحليل (§14 في القاموس)
CREATE TABLE order_assignments (
  id                        UUID                      PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                  UUID                      NOT NULL REFERENCES orders(id),
  technician_id             UUID                      NOT NULL REFERENCES technician_profiles(id),
  assignment_round          SMALLINT                  NOT NULL,
  distance_km               NUMERIC(6,2)              NULL,
  estimated_eta_minutes     SMALLINT                  NULL,
  assignment_status         order_assignment_status   NOT NULL DEFAULT 'sent',
  rejection_reason_code     VARCHAR(40)               NULL,
  sent_at                   TIMESTAMPTZ               NOT NULL DEFAULT now(),
  responded_at              TIMESTAMPTZ               NULL,
  expires_at                TIMESTAMPTZ               NOT NULL
);
CREATE INDEX idx_order_assignments_order_id ON order_assignments(order_id);
CREATE INDEX idx_order_assignments_technician_id ON order_assignments(technician_id);
CREATE INDEX idx_order_assignments_status ON order_assignments(assignment_status);
