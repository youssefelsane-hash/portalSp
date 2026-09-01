-- Monthly is an admin-facing preset. Runtime converts it to the same formula path as every
-- other pricing model: monthly_units (pricing_quantity) * monthly_rate (base_price_cents).
ALTER TYPE pricing_model ADD VALUE IF NOT EXISTS 'monthly';
