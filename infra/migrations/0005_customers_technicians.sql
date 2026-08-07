-- baytak — 0005: العملاء والفنيين
-- مرجع: docs/02-data-dictionary.md §4

CREATE TABLE customer_profiles (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                   UUID          NOT NULL UNIQUE REFERENCES users(id),
  default_address_id        UUID          NULL REFERENCES addresses(id),
  total_orders_count        INTEGER       NOT NULL DEFAULT 0,
  completed_orders_count    INTEGER       NOT NULL DEFAULT 0,
  cancelled_orders_count    INTEGER       NOT NULL DEFAULT 0,
  total_spent_cents         INTEGER       NOT NULL DEFAULT 0,
  loyalty_points_balance    INTEGER       NOT NULL DEFAULT 0,
  customer_tier             customer_tier NOT NULL DEFAULT 'standard',
  average_rating_given      NUMERIC(3,2)  NULL,
  is_high_risk              BOOLEAN       NOT NULL DEFAULT false,
  first_order_at            TIMESTAMPTZ   NULL,
  last_order_at             TIMESTAMPTZ   NULL,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ   NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON customer_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_profiles (
  id                              UUID                            PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id                         UUID                            NOT NULL UNIQUE REFERENCES users(id),
  technician_code                 VARCHAR(20)                     NOT NULL UNIQUE,   -- TECH-000123
  national_id_encrypted           TEXT                            NOT NULL,          -- AES-256 في طبقة التطبيق
  date_of_birth                   DATE                            NULL,
  gender                          gender_type                     NULL,
  bio                             TEXT                            NULL,
  years_of_experience             SMALLINT                        NOT NULL DEFAULT 0,
  current_level                   technician_level                NOT NULL DEFAULT 'bronze',
  quality_score                   NUMERIC(5,2)                    NOT NULL DEFAULT 0,
  average_rating                  NUMERIC(3,2)                    NOT NULL DEFAULT 0,
  total_ratings_count             INTEGER                         NOT NULL DEFAULT 0,
  completed_orders_count          INTEGER                         NOT NULL DEFAULT 0,
  cancelled_orders_count          INTEGER                         NOT NULL DEFAULT 0,
  on_time_rate                    NUMERIC(5,2)                    NOT NULL DEFAULT 0,
  acceptance_rate                 NUMERIC(5,2)                    NOT NULL DEFAULT 0,
  completion_rate                 NUMERIC(5,2)                    NOT NULL DEFAULT 0,
  complaint_rate                  NUMERIC(5,2)                    NOT NULL DEFAULT 0,
  verification_status             technician_verification_status  NOT NULL DEFAULT 'pending',
  verification_notes              TEXT                            NULL,
  approved_at                     TIMESTAMPTZ                     NULL,
  approved_by_user_id             UUID                            NULL REFERENCES users(id),
  is_available                    BOOLEAN                         NOT NULL DEFAULT false,
  is_on_duty                      BOOLEAN                         NOT NULL DEFAULT false,
  current_location                GEOGRAPHY(POINT)                NULL,
  current_location_updated_at     TIMESTAMPTZ                     NULL,
  home_area_id                    UUID                            NULL REFERENCES areas(id),
  max_daily_orders                SMALLINT                        NOT NULL DEFAULT 8,
  has_own_transport               BOOLEAN                         NOT NULL DEFAULT false,
  has_own_tools                   BOOLEAN                         NOT NULL DEFAULT true,
  emergency_available              BOOLEAN                        NOT NULL DEFAULT false,
  bank_account_number_encrypted   TEXT                            NULL,
  bank_name                       VARCHAR(80)                     NULL,
  wallet_provider                 VARCHAR(40)                     NULL,   -- vodafone_cash | instapay | bank
  wallet_number_encrypted         TEXT                            NULL,
  contract_signed_at              TIMESTAMPTZ                     NULL,
  suspended_until                 TIMESTAMPTZ                     NULL,
  suspension_reason               TEXT                            NULL,
  created_at                      TIMESTAMPTZ                     NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ                     NOT NULL DEFAULT now(),
  deleted_at                      TIMESTAMPTZ                     NULL
);
CREATE INDEX idx_technician_profiles_verification_status ON technician_profiles(verification_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_technician_profiles_current_location ON technician_profiles USING GIST(current_location);
CREATE INDEX idx_technician_profiles_available ON technician_profiles(is_available, is_on_duty) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_documents (
  id                    UUID                        PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id         UUID                        NOT NULL REFERENCES technician_profiles(id),
  document_type         technician_document_type    NOT NULL,
  file_url              TEXT                        NOT NULL,
  file_size_bytes       INTEGER                     NULL,
  mime_type             VARCHAR(60)                 NULL,
  review_status         document_review_status      NOT NULL DEFAULT 'pending',
  rejection_reason      TEXT                        NULL,
  reviewed_by_user_id   UUID                        NULL REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ                 NULL,
  expires_at            DATE                        NULL,
  created_at            TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ                 NULL
);
CREATE INDEX idx_technician_documents_technician_id ON technician_documents(technician_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_zones (
  id                UUID    PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id     UUID    NOT NULL REFERENCES technician_profiles(id),
  service_zone_id   UUID    NOT NULL REFERENCES service_zones(id),
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ NULL,
  UNIQUE (technician_id, service_zone_id)
);
CREATE INDEX idx_technician_zones_zone_id ON technician_zones(service_zone_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_zones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_level_history (
  id                          UUID                          PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id               UUID                          NOT NULL REFERENCES technician_profiles(id),
  previous_level               technician_level             NULL,
  new_level                    technician_level              NOT NULL,
  change_type                  technician_level_change_type  NOT NULL,
  quality_score_at_change      NUMERIC(5,2)                  NOT NULL,
  reason                       TEXT                          NULL,
  changed_by_user_id           UUID                          NULL REFERENCES users(id),
  effective_from                TIMESTAMPTZ                  NOT NULL DEFAULT now(),
  created_at                   TIMESTAMPTZ                   NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_level_history_technician_id ON technician_level_history(technician_id);

CREATE TABLE technician_availability (
  id              UUID      PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id   UUID      NOT NULL REFERENCES technician_profiles(id),
  day_of_week     SMALLINT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=الأحد ... 6=السبت
  start_time      TIME      NOT NULL,
  end_time        TIME      NOT NULL,
  is_active       BOOLEAN   NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_technician_availability_technician_id ON technician_availability(technician_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_availability
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- technician_services بترجع لجدول services اللي بيتعرّف في 0006_catalog.sql — موجود هناك في آخر الملف.
