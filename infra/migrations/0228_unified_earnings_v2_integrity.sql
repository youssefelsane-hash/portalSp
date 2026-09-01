-- Integrity and permission hardening for Unified Workforce Earnings Engine V2.
-- 0227 is intentionally additive; these constraints make malformed V2 snapshots impossible
-- while leaving every V1 order and share unchanged.

COMMENT ON COLUMN services.commission_percentage IS
  'Deprecated V1 settlement input. Read-only in admin APIs; retained only for historical V1 orders.';
COMMENT ON COLUMN technician_level_config.commission_adjustment_percentage IS
  'Deprecated V1 settlement input. Read-only and retained only for historical V1 orders.';
COMMENT ON COLUMN technician_level_config.crew_share_weight IS
  'Deprecated V1 crew split input. Read-only and retained only for historical V1 orders.';
COMMENT ON COLUMN technician_level_config.assistant_earning_multiplier IS
  'Deprecated V1 fixed assistant target input. Read-only and retained only for historical V1 orders.';

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_v2_has_fixed_commission_snapshot
  CHECK (
    settlement_policy_version <> 2
    OR platform_commission_cents_snapshot IS NOT NULL
  );

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_v2_completed_settlement_balances
  CHECK (
    settlement_policy_version <> 2
    OR paid_at IS NULL
    OR (
      worker_pool_cents IS NOT NULL
      AND calculation_algorithm_version IS NOT NULL
      AND platform_commission_cents = platform_commission_cents_snapshot
      AND platform_commission_cents + worker_pool_cents = total_amount_cents
      AND technician_earning_cents = worker_pool_cents
    )
  );

ALTER TABLE order_earning_shares
  ADD CONSTRAINT chk_order_earning_shares_v2_complete_snapshot
  CHECK (
    settlement_policy_version <> 2
    OR (
      calculation_method = 'earnings_policy_v2'
      AND calculation_algorithm_version IS NOT NULL
      AND technician_kind_snapshot IS NOT NULL
      AND earning_role IS NOT NULL
      AND level_weight_bps_snapshot IS NOT NULL
      AND assistant_ratio_bps_snapshot IS NOT NULL
      AND service_skill_snapshot IS NOT NULL
      AND service_skill_factor_bps_snapshot IS NOT NULL
      AND individual_adjustment_bps_snapshot IS NOT NULL
      AND order_adjustment_bps_snapshot IS NOT NULL
      AND effective_weight_units IS NOT NULL
    )
  );

ALTER TABLE order_earning_shares
  ADD CONSTRAINT chk_order_earning_shares_v2_positive_factors
  CHECK (
    settlement_policy_version <> 2
    OR (
      level_weight_bps_snapshot > 0
      AND assistant_ratio_bps_snapshot > 0
      AND service_skill_factor_bps_snapshot > 0
      AND effective_weight_units > 0
    )
  );

-- New permissions were created after the original super-admin permission seed, so they must be
-- assigned explicitly. Finance manages policy; operations can inspect but cannot alter money.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'earnings_policy.view', 'earnings_policy.manage',
  'platform_commission.view', 'platform_commission.manage',
  'technician_earning_adjustment.view', 'technician_earning_adjustment.manage',
  'settlement.view', 'settlement_override.manage'
)
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

