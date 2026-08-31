-- Unified Workforce Earnings Engine V2.
--
-- This migration is additive and deliberately leaves every V1 column intact. Existing orders
-- remain settlement_policy_version=1; V2 is enabled only after finance configures a fixed
-- commission for every active service and explicitly completes the cutover.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS platform_commission_cents integer NULL
    CHECK (platform_commission_cents IS NULL OR platform_commission_cents >= 0);

COMMENT ON COLUMN services.platform_commission_cents IS
  'V2 fixed platform commission in piasters. NULL means the service is not ready for V2 cutover.';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS settlement_policy_version smallint NOT NULL DEFAULT 1
    CHECK (settlement_policy_version IN (1, 2)),
  ADD COLUMN IF NOT EXISTS platform_commission_cents_snapshot integer NULL
    CHECK (platform_commission_cents_snapshot IS NULL OR platform_commission_cents_snapshot >= 0),
  ADD COLUMN IF NOT EXISTS worker_pool_cents integer NULL
    CHECK (worker_pool_cents IS NULL OR worker_pool_cents >= 0),
  ADD COLUMN IF NOT EXISTS calculation_algorithm_version varchar(40) NULL;

COMMENT ON COLUMN orders.settlement_policy_version IS
  '1=legacy percentage settlement, 2=fixed commission plus unified weighted earnings engine.';
COMMENT ON COLUMN orders.platform_commission_cents_snapshot IS
  'Immutable fixed commission captured when a V2 order is created.';
COMMENT ON COLUMN orders.worker_pool_cents IS
  'Final V2 worker pool: final order total minus the fixed commission snapshot.';

ALTER TABLE technician_level_config
  ADD COLUMN IF NOT EXISTS earning_weight_bps integer NOT NULL DEFAULT 10000
    CHECK (earning_weight_bps > 0 AND earning_weight_bps <= 100000),
  ADD COLUMN IF NOT EXISTS assistant_ratio_bps integer NOT NULL DEFAULT 6500
    CHECK (assistant_ratio_bps > 0 AND assistant_ratio_bps <= 10000);

-- Preserve the established level ordering while moving it to deterministic integer policy.
UPDATE technician_level_config SET earning_weight_bps = 10000, assistant_ratio_bps = 6500 WHERE level = 'new';
UPDATE technician_level_config SET earning_weight_bps = 11000, assistant_ratio_bps = 7000 WHERE level = 'verified';
UPDATE technician_level_config SET earning_weight_bps = 12500, assistant_ratio_bps = 7600 WHERE level = 'professional';
UPDATE technician_level_config SET earning_weight_bps = 14500, assistant_ratio_bps = 8300 WHERE level = 'premium';
UPDATE technician_level_config SET earning_weight_bps = 16000, assistant_ratio_bps = 9000 WHERE level = 'team_leader';

COMMENT ON COLUMN technician_level_config.earning_weight_bps IS
  'V2 technician earning weight. 10000 means 1.00. Does not affect customer price or platform commission.';
COMMENT ON COLUMN technician_level_config.assistant_ratio_bps IS
  'V2 assistant weight relative to a technician at the same level. 6500 means 65.00%.';

CREATE TABLE earnings_skill_policy (
  skill_level       skill_level PRIMARY KEY,
  factor_bps        integer NOT NULL CHECK (factor_bps > 0 AND factor_bps <= 30000),
  updated_by_user_id uuid NULL REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO earnings_skill_policy (skill_level, factor_bps) VALUES
  ('beginner', 9500),
  ('standard', 10000),
  ('expert', 11000)
ON CONFLICT (skill_level) DO NOTHING;

CREATE TABLE service_earnings_level_overrides (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id          uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  technician_level    technician_level NOT NULL,
  assistant_ratio_bps integer NOT NULL CHECK (assistant_ratio_bps > 0 AND assistant_ratio_bps <= 10000),
  updated_by_user_id  uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, technician_level)
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_earnings_level_overrides
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE service_earnings_skill_overrides (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  service_id          uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  skill_level         skill_level NOT NULL,
  factor_bps          integer NOT NULL CHECK (factor_bps > 0 AND factor_bps <= 30000),
  updated_by_user_id  uuid NOT NULL REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, skill_level)
);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON service_earnings_skill_overrides
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE technician_earning_adjustments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  technician_id       uuid NOT NULL REFERENCES technician_profiles(id) ON DELETE CASCADE,
  service_id          uuid NULL REFERENCES services(id) ON DELETE CASCADE,
  adjustment_bps      integer NOT NULL CHECK (adjustment_bps > -10000 AND adjustment_bps <= 20000),
  reason              text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  effective_from      timestamptz NOT NULL DEFAULT now(),
  effective_until     timestamptz NULL,
  created_by_user_id  uuid NOT NULL REFERENCES users(id),
  updated_by_user_id  uuid NOT NULL REFERENCES users(id),
  disabled_at         timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX idx_technician_earning_adjustments_lookup
  ON technician_earning_adjustments(technician_id, service_id, effective_from DESC)
  WHERE disabled_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON technician_earning_adjustments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE order_earning_adjustments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  technician_id       uuid NOT NULL REFERENCES technician_profiles(id),
  adjustment_bps      integer NOT NULL CHECK (adjustment_bps > -10000 AND adjustment_bps <= 20000),
  reason              text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  created_by_user_id  uuid NOT NULL REFERENCES users(id),
  disabled_at         timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_order_earning_adjustments_active
  ON order_earning_adjustments(order_id, technician_id)
  WHERE disabled_at IS NULL;

ALTER TABLE order_earning_shares
  ADD COLUMN IF NOT EXISTS settlement_policy_version smallint NOT NULL DEFAULT 1
    CHECK (settlement_policy_version IN (1, 2)),
  ADD COLUMN IF NOT EXISTS calculation_algorithm_version varchar(40) NULL,
  ADD COLUMN IF NOT EXISTS technician_kind_snapshot varchar(20) NULL
    CHECK (technician_kind_snapshot IS NULL OR technician_kind_snapshot IN ('technician', 'assistant')),
  ADD COLUMN IF NOT EXISTS earning_role varchar(20) NULL
    CHECK (earning_role IS NULL OR earning_role IN ('technician', 'assistant')),
  ADD COLUMN IF NOT EXISTS level_weight_bps_snapshot integer NULL,
  ADD COLUMN IF NOT EXISTS assistant_ratio_bps_snapshot integer NULL,
  ADD COLUMN IF NOT EXISTS service_skill_snapshot skill_level NULL,
  ADD COLUMN IF NOT EXISTS service_skill_factor_bps_snapshot integer NULL,
  ADD COLUMN IF NOT EXISTS individual_adjustment_bps_snapshot integer NULL,
  ADD COLUMN IF NOT EXISTS order_adjustment_bps_snapshot integer NULL,
  ADD COLUMN IF NOT EXISTS effective_weight_units numeric(40,0) NULL;

ALTER TABLE order_earning_shares
  DROP CONSTRAINT IF EXISTS order_earning_shares_calculation_method_check;
ALTER TABLE order_earning_shares
  ADD CONSTRAINT order_earning_shares_calculation_method_check
  CHECK (calculation_method IN ('weighted_pool', 'assistant_level_wage', 'earnings_policy_v2', 'manual_override'));

CREATE TABLE refund_settlement_reversals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  refund_id             uuid NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_id              uuid NOT NULL REFERENCES orders(id),
  bucket_type           varchar(20) NOT NULL CHECK (bucket_type IN ('platform', 'participant')),
  technician_id         uuid NULL REFERENCES technician_profiles(id),
  original_bucket_cents integer NOT NULL CHECK (original_bucket_cents >= 0),
  reversal_cents        integer NOT NULL CHECK (reversal_cents >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((bucket_type = 'platform' AND technician_id IS NULL) OR
         (bucket_type = 'participant' AND technician_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_refund_settlement_reversal_bucket
  ON refund_settlement_reversals(refund_id, bucket_type, COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE earnings_shadow_comparisons (
  id                            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                      uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  legacy_platform_cents         integer NOT NULL,
  legacy_worker_pool_cents      integer NOT NULL,
  v2_platform_cents             integer NOT NULL,
  v2_worker_pool_cents          integer NOT NULL,
  v2_participant_shares         jsonb NOT NULL DEFAULT '[]'::jsonb,
  absolute_delta_cents          integer NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('earnings.v2_cutover_enabled', 'false'::jsonb, 'boolean', 'payments',
   'Enable policy version 2 for newly created paid orders only after readiness reaches 100%.', false),
  ('earnings.v2_shadow_enabled', 'true'::jsonb, 'boolean', 'payments',
   'Compare legacy and V2 results without posting V2 wallet movements.', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (name, resource, action) VALUES
  ('earnings_policy.view', 'earnings_policy', 'view'),
  ('earnings_policy.manage', 'earnings_policy', 'manage'),
  ('platform_commission.view', 'platform_commission', 'view'),
  ('platform_commission.manage', 'platform_commission', 'manage'),
  ('technician_earning_adjustment.view', 'technician_earning_adjustment', 'view'),
  ('technician_earning_adjustment.manage', 'technician_earning_adjustment', 'manage'),
  ('settlement.view', 'settlement', 'view'),
  ('settlement_override.manage', 'settlement_override', 'manage')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'earnings_policy.view', 'earnings_policy.manage',
  'platform_commission.view', 'platform_commission.manage',
  'technician_earning_adjustment.view', 'technician_earning_adjustment.manage',
  'settlement.view', 'settlement_override.manage'
)
WHERE r.name = 'finance'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('earnings_policy.view', 'platform_commission.view', 'settlement.view')
WHERE r.name = 'ops_manager'
ON CONFLICT DO NOTHING;
