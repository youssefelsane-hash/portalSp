-- baytak — 0004: الجغرافيا والعناوين
-- مرجع: docs/02-data-dictionary.md §3

CREATE TABLE countries (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  name_ar         VARCHAR(120)  NOT NULL,
  name_en         VARCHAR(120)  NOT NULL,
  iso_code        VARCHAR(2)    NOT NULL UNIQUE,
  phone_prefix    VARCHAR(6)    NOT NULL,
  currency_code   VARCHAR(3)    NOT NULL,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ   NULL
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE cities (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  country_id        UUID              NOT NULL REFERENCES countries(id),
  name_ar           VARCHAR(120)      NOT NULL,
  name_en           VARCHAR(120)      NOT NULL,
  slug              VARCHAR(120)      NOT NULL UNIQUE,
  center_location   GEOGRAPHY(POINT)  NULL,
  timezone          VARCHAR(40)       NOT NULL DEFAULT 'Africa/Cairo',
  is_active         BOOLEAN           NOT NULL DEFAULT false,
  launched_at       TIMESTAMPTZ       NULL,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ       NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ       NULL
);
CREATE INDEX idx_cities_country_id ON cities(country_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE areas (
  id                UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  city_id           UUID                NOT NULL REFERENCES cities(id),
  name_ar           VARCHAR(120)        NOT NULL,
  name_en           VARCHAR(120)        NOT NULL,
  slug              VARCHAR(120)        NOT NULL,
  boundary          GEOGRAPHY(POLYGON)  NULL,
  center_location   GEOGRAPHY(POINT)    NULL,
  is_active         BOOLEAN             NOT NULL DEFAULT true,
  is_launched       BOOLEAN             NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ         NULL,
  UNIQUE (city_id, slug)
);
CREATE INDEX idx_areas_city_id ON areas(city_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_areas_boundary ON areas USING GIST(boundary);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- نطاق تشغيلي = مجموعة أحياء لها نفس قواعد التسعير
CREATE TABLE service_zones (
  id                        UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  city_id                   UUID                NOT NULL REFERENCES cities(id),
  name_ar                   VARCHAR(120)        NOT NULL,
  name_en                   VARCHAR(120)        NOT NULL,
  boundary                  GEOGRAPHY(POLYGON)  NULL,
  surge_multiplier          NUMERIC(4,2)        NOT NULL DEFAULT 1.00,
  min_order_amount_cents    INTEGER             NULL,
  is_active                 BOOLEAN             NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ         NULL
);
CREATE INDEX idx_service_zones_city_id ON service_zones(city_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_service_zones_boundary ON service_zones USING GIST(boundary);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_zones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE addresses (
  id                    UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id               UUID              NOT NULL REFERENCES users(id),
  label                 VARCHAR(40)       NULL,        -- البيت | الشغل | بيت ماما
  city_id               UUID              NULL REFERENCES cities(id),
  area_id               UUID              NULL REFERENCES areas(id),
  street_name           VARCHAR(160)      NOT NULL,
  building_number       VARCHAR(20)       NULL,
  floor_number          VARCHAR(10)       NULL,
  apartment_number      VARCHAR(10)       NULL,
  landmark              VARCHAR(200)      NULL,        -- أهم من رقم العمارة في مصر
  location              GEOGRAPHY(POINT)  NOT NULL,
  contact_name          VARCHAR(120)      NULL,
  contact_phone         VARCHAR(15)       NULL,
  delivery_notes        TEXT              NULL,
  is_default            BOOLEAN           NOT NULL DEFAULT false,
  is_verified           BOOLEAN           NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ       NULL
);
CREATE INDEX idx_addresses_user_id ON addresses(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_addresses_location ON addresses USING GIST(location);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code, is_active)
VALUES ('مصر', 'Egypt', 'EG', '+20', 'EGP', true);
