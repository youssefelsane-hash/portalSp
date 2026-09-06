-- يستبدل قيد العمولة الثابتة بقيد جمع النسبة: بعد التسوية، عمولة المنصة + وعاء العاملين
-- يجب أن تساوي إجمالي الطلب، بلا اعتماد على مبلغ ثابت من الكتالوج.
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS chk_orders_v2_completed_settlement_balances;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_percentage_earnings_settlement_balances
  CHECK (
    settlement_policy_version <> 2
    OR paid_at IS NULL
    OR (
      worker_pool_cents IS NOT NULL
      AND calculation_algorithm_version IS NOT NULL
      AND platform_commission_cents + worker_pool_cents = total_amount_cents
      AND technician_earning_cents = worker_pool_cents
    )
  );
