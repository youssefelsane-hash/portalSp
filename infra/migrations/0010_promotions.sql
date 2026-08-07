-- baytak — 0010: العروض والولاء
-- مرجع: docs/02-data-dictionary.md §10

CREATE TABLE promo_codes (
  id                          UUID            PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                        VARCHAR(24)     NOT NULL UNIQUE,
  name_ar                     VARCHAR(120)    NOT NULL,
  discount_type               discount_type   NOT NULL,
  discount_value               NUMERIC(10,2)  NOT NULL,
  max_discount_cents          INTEGER         NULL,
  min_order_amount_cents      INTEGER         NOT NULL DEFAULT 0,
  usage_limit_total           INTEGER         NULL,
  usage_limit_per_user        SMALLINT        NOT NULL DEFAULT 1,
  used_count                  INTEGER         NOT NULL DEFAULT 0,
  applies_to_service_ids      UUID[]          NULL,
  applies_to_zone_ids         UUID[]          NULL,
  new_customers_only          BOOLEAN         NOT NULL DEFAULT false,
  valid_from                  TIMESTAMPTZ     NOT NULL,
  valid_until                 TIMESTAMPTZ     NOT NULL,
  is_active                   BOOLEAN         NOT NULL DEFAULT true,
  created_by_user_id          UUID            NOT NULL REFERENCES users(id),
  budget_cents                INTEGER         NULL,
  spent_cents                 INTEGER         NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ     NULL
);
CREATE INDEX idx_promo_codes_code ON promo_codes(code) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON promo_codes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- الـ FK اللي اتأجل من 0007_orders.sql لحد ما promo_codes اتعرفت
ALTER TABLE orders
  ADD CONSTRAINT fk_orders_promo_code FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id);

CREATE TABLE promo_code_usages (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v7(),
  promo_code_id             UUID          NOT NULL REFERENCES promo_codes(id),
  user_id                   UUID          NOT NULL REFERENCES users(id),
  order_id                  UUID          NOT NULL REFERENCES orders(id),
  discount_applied_cents    INTEGER       NOT NULL,
  used_at                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, order_id)
);
CREATE INDEX idx_promo_code_usages_user_id ON promo_code_usages(user_id);

CREATE TABLE loyalty_transactions (
  id                UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id           UUID                NOT NULL REFERENCES users(id),
  points_amount     INTEGER              NOT NULL,
  direction         loyalty_direction   NOT NULL,
  source            loyalty_source      NOT NULL,
  reference_id      UUID                NULL,
  balance_after     INTEGER             NOT NULL,
  expires_at        TIMESTAMPTZ         NULL,
  created_at        TIMESTAMPTZ         NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_transactions_user_id ON loyalty_transactions(user_id);
