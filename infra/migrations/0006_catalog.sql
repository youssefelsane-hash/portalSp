-- baytak — 0006: الكتالوج والتسعير
-- مرجع: docs/02-data-dictionary.md §5

CREATE TABLE service_categories (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  parent_category_id    UUID          NULL REFERENCES service_categories(id),
  name_ar               VARCHAR(120)  NOT NULL,
  name_en               VARCHAR(120)  NOT NULL,
  slug                  VARCHAR(120)  NOT NULL UNIQUE,
  description_ar        TEXT          NULL,
  description_en        TEXT          NULL,
  icon_url              TEXT          NULL,
  cover_image_url       TEXT          NULL,
  display_order         SMALLINT      NOT NULL DEFAULT 0,
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  is_featured           BOOLEAN       NOT NULL DEFAULT false,
  launch_phase          SMALLINT      NOT NULL DEFAULT 1,   -- 1 = MVP، 2 = المرحلة الثانية ...
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ   NULL
);
CREATE INDEX idx_service_categories_parent_id ON service_categories(parent_category_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE services (
  id                            UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  category_id                   UUID              NOT NULL REFERENCES service_categories(id),
  name_ar                       VARCHAR(120)      NOT NULL,
  name_en                       VARCHAR(120)      NULL,
  slug                          VARCHAR(120)      NOT NULL UNIQUE,
  short_description_ar          VARCHAR(255)      NULL,
  full_description_ar           TEXT              NULL,
  icon_url                      TEXT              NULL,
  pricing_model                 pricing_model     NOT NULL,
  base_price_cents              INTEGER           NOT NULL,
  inspection_fee_cents          INTEGER           NOT NULL DEFAULT 0,
  min_price_cents                INTEGER          NULL,
  max_price_cents                INTEGER          NULL,
  unit_name_ar                  VARCHAR(40)       NULL,      -- ساعة | متر | قطعة | جهاز
  estimated_duration_minutes    SMALLINT          NULL,
  warranty_days                 SMALLINT          NOT NULL DEFAULT 0,
  requires_photos               BOOLEAN           NOT NULL DEFAULT false,
  allows_scheduling             BOOLEAN           NOT NULL DEFAULT true,
  allows_emergency               BOOLEAN          NOT NULL DEFAULT false,
  min_technician_level          technician_level  NOT NULL DEFAULT 'bronze',
  commission_percentage         NUMERIC(5,2)      NOT NULL DEFAULT 15.00,
  display_order                 SMALLINT          NOT NULL DEFAULT 0,
  is_active                     BOOLEAN           NOT NULL DEFAULT true,
  launch_phase                  SMALLINT          NOT NULL DEFAULT 1,
  created_at                    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  deleted_at                    TIMESTAMPTZ       NULL
);
CREATE INDEX idx_services_category_id ON services(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_services_is_active ON services(is_active) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE service_zone_pricing (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id              UUID          NOT NULL REFERENCES services(id),
  service_zone_id         UUID          NOT NULL REFERENCES service_zones(id),
  price_cents             INTEGER       NOT NULL,
  inspection_fee_cents    INTEGER       NOT NULL DEFAULT 0,
  surge_multiplier        NUMERIC(4,2)  NOT NULL DEFAULT 1.00,
  valid_from              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  valid_until             TIMESTAMPTZ   NULL,
  is_active               BOOLEAN       NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_zone_pricing_lookup ON service_zone_pricing(service_id, service_zone_id) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_zone_pricing
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE service_level_pricing (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id          UUID              NOT NULL REFERENCES services(id),
  technician_level    technician_level  NOT NULL,
  price_multiplier    NUMERIC(4,2)      NOT NULL,   -- bronze 1.00 | silver 1.10 | gold 1.25 | platinum 1.45
  is_active           BOOLEAN           NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (service_id, technician_level)
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_level_pricing
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE service_addons (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id          UUID          NOT NULL REFERENCES services(id),
  name_ar             VARCHAR(120)  NOT NULL,
  name_en             VARCHAR(120)  NULL,
  price_cents         INTEGER       NOT NULL,
  duration_minutes    SMALLINT      NULL,
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  display_order       SMALLINT      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ   NULL
);
CREATE INDEX idx_service_addons_service_id ON service_addons(service_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_addons
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ربط الفني بالخدمات (مؤجل من 0005 لأنه محتاج services)
CREATE TABLE technician_services (
  id                  UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id       UUID          NOT NULL REFERENCES technician_profiles(id),
  service_id          UUID          NOT NULL REFERENCES services(id),
  skill_level         skill_level   NOT NULL DEFAULT 'standard',
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  completed_count     INTEGER       NOT NULL DEFAULT 0,
  average_rating      NUMERIC(3,2)  NULL,
  tested_at           TIMESTAMPTZ   NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (technician_id, service_id)
);
CREATE INDEX idx_technician_services_service_id ON technician_services(service_id) WHERE is_active = true;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_services
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- كتالوج MVP (سباكة، كهرباء، تكييف، تنظيف) — المرحلة 1 في الماستر بلان
INSERT INTO service_categories (name_ar, name_en, slug, display_order, launch_phase) VALUES
  ('سباكة', 'Plumbing', 'plumbing', 1, 1),
  ('كهرباء', 'Electrical', 'electrical', 2, 1),
  ('تكييف', 'AC & Cooling', 'ac-cooling', 3, 1),
  ('تنظيف', 'Cleaning', 'cleaning', 4, 1);
