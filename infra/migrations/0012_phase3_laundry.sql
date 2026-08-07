-- baytak — 0012: المرحلة 3 — المغاسل (تصميم مبدئي، مش هيتفعل قبل بوابة P2)
-- مرجع: docs/02-data-dictionary.md §12 (المرحلة 3)

CREATE TABLE laundry_partners (
  id                            UUID                     PRIMARY KEY DEFAULT uuid_generate_v7(),
  business_name                 VARCHAR(160)             NOT NULL,
  owner_user_id                 UUID                     NOT NULL REFERENCES users(id),
  commercial_register_number    VARCHAR(60)              NULL,
  address_id                    UUID                     NOT NULL REFERENCES addresses(id),
  service_zone_ids              UUID[]                   NOT NULL DEFAULT '{}',
  capacity_per_day              INTEGER                  NULL,
  turnaround_hours              SMALLINT                 NULL,
  partner_status                laundry_partner_status   NOT NULL DEFAULT 'pending',
  commission_rate               NUMERIC(5,2)             NOT NULL DEFAULT 15.00,
  dashboard_plan                laundry_dashboard_plan   NOT NULL DEFAULT 'free',
  rating                        NUMERIC(3,2)             NULL,
  created_at                    TIMESTAMPTZ              NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ              NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ              NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON laundry_partners
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE laundry_orders (
  id                        UUID                  PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_number              VARCHAR(24)           NOT NULL UNIQUE,
  customer_id               UUID                  NOT NULL REFERENCES customer_profiles(id),
  laundry_partner_id        UUID                  NOT NULL REFERENCES laundry_partners(id),
  pickup_courier_id         UUID                  NULL REFERENCES technician_profiles(id),
  delivery_courier_id       UUID                  NULL REFERENCES technician_profiles(id),
  pickup_address_id         UUID                  NOT NULL REFERENCES addresses(id),
  pickup_scheduled_at       TIMESTAMPTZ           NULL,
  delivery_scheduled_at     TIMESTAMPTZ           NULL,
  items_count               SMALLINT              NOT NULL DEFAULT 0,
  total_weight_kg           NUMERIC(6,2)          NULL,
  laundry_status            laundry_order_status  NOT NULL DEFAULT 'requested',
  qr_batch_code             VARCHAR(40)           NOT NULL UNIQUE,
  created_at                TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ           NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ           NULL
);
CREATE INDEX idx_laundry_orders_partner_id ON laundry_orders(laundry_partner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_laundry_orders_customer_id ON laundry_orders(customer_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON laundry_orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE laundry_items (
  id                    UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  laundry_order_id      UUID                        NOT NULL REFERENCES laundry_orders(id),
  qr_code               VARCHAR(60)                 NOT NULL UNIQUE,
  item_type             VARCHAR(60)                 NOT NULL,
  color                 VARCHAR(40)                 NULL,
  fabric                VARCHAR(60)                 NULL,
  service_type          laundry_item_service_type   NOT NULL,
  price_cents           INTEGER                     NOT NULL,
  item_status           laundry_item_status         NOT NULL DEFAULT 'received',
  condition_notes       TEXT                        NULL,
  before_photo_url      TEXT                        NULL,
  after_photo_url       TEXT                        NULL,
  is_damaged            BOOLEAN                     NOT NULL DEFAULT false,
  damage_report         TEXT                        NULL,
  created_at             TIMESTAMPTZ                NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ                NOT NULL DEFAULT now()
);
CREATE INDEX idx_laundry_items_order_id ON laundry_items(laundry_order_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON laundry_items
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
