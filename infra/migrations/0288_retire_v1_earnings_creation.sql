-- V1 remains readable solely for historical accounting. No newly persisted order or earning
-- share may silently default to it, and the former cutover switch is permanently locked on.
ALTER TABLE orders
  ALTER COLUMN settlement_policy_version SET DEFAULT 2;

ALTER TABLE order_earning_shares
  ALTER COLUMN settlement_policy_version SET DEFAULT 2;

UPDATE settings
   SET value = 'true'::jsonb,
       updated_at = now()
 WHERE key = 'earnings.v2_cutover_enabled';
