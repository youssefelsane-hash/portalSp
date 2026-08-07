-- baytak — 0016: المرحلة 8 — Home Management (تصميم مبدئي)
-- مرجع: docs/02-data-dictionary.md §12 (المرحلة 8)

CREATE TABLE home_profiles (
  id                UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  customer_id       UUID                NOT NULL REFERENCES customer_profiles(id),
  address_id        UUID                NOT NULL REFERENCES addresses(id),
  property_type     home_property_type  NOT NULL,
  area_sqm          NUMERIC(8,2)        NULL,
  rooms_count       SMALLINT            NULL,
  bathrooms_count   SMALLINT            NULL,
  build_year        SMALLINT            NULL,
  is_primary        BOOLEAN             NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ         NULL
);
CREATE INDEX idx_home_profiles_customer_id ON home_profiles(customer_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON home_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE home_appliances (
  id                            UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  home_profile_id               UUID                        NOT NULL REFERENCES home_profiles(id),
  appliance_type                VARCHAR(60)                 NOT NULL,
  brand                         VARCHAR(60)                 NULL,
  model                         VARCHAR(80)                 NULL,
  serial_number                 VARCHAR(80)                 NULL,
  purchase_date                 DATE                        NULL,
  purchase_price_cents          INTEGER                     NULL,
  warranty_expires_at           DATE                        NULL,
  warranty_document_url         TEXT                        NULL,
  installation_date             DATE                        NULL,
  last_maintenance_at           DATE                        NULL,
  next_maintenance_due_at       DATE                        NULL,
  maintenance_interval_days     SMALLINT                    NULL,
  room_location                 VARCHAR(60)                 NULL,
  condition_status               home_appliance_condition   NOT NULL DEFAULT 'good',
  created_at                    TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ                 NULL
);
CREATE INDEX idx_home_appliances_home_profile_id ON home_appliances(home_profile_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON home_appliances
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE maintenance_schedules (
  id                          UUID                            PRIMARY KEY DEFAULT uuid_generate_v7(),
  home_profile_id             UUID                            NOT NULL REFERENCES home_profiles(id),
  appliance_id                UUID                            NULL REFERENCES home_appliances(id),
  service_id                  UUID                            NOT NULL REFERENCES services(id),
  title_ar                    VARCHAR(120)                    NOT NULL,
  recurrence_type              maintenance_recurrence_type    NOT NULL,
  interval_days                SMALLINT                       NULL,
  next_due_at                  TIMESTAMPTZ                    NOT NULL,
  last_completed_at            TIMESTAMPTZ                    NULL,
  reminder_days_before         SMALLINT                       NOT NULL DEFAULT 7,
  is_active                    BOOLEAN                        NOT NULL DEFAULT true,
  auto_book                    BOOLEAN                        NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ                    NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ                    NOT NULL DEFAULT now()
);
CREATE INDEX idx_maintenance_schedules_home_profile_id ON maintenance_schedules(home_profile_id);
CREATE INDEX idx_maintenance_schedules_next_due_at ON maintenance_schedules(next_due_at) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE home_documents (
  id                    UUID                    PRIMARY KEY DEFAULT uuid_generate_v7(),
  home_profile_id       UUID                    NOT NULL REFERENCES home_profiles(id),
  document_type         home_document_type      NOT NULL,
  title                 VARCHAR(160)            NOT NULL,
  file_url              TEXT                    NOT NULL,
  related_order_id      UUID                    NULL REFERENCES orders(id),
  expires_at            DATE                    NULL,
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT now()
);
CREATE INDEX idx_home_documents_home_profile_id ON home_documents(home_profile_id);
