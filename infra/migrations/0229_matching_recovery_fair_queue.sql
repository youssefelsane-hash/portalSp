-- Fair, configurable matching recovery. A stalled order stays searchable forever, but it no
-- longer monopolizes every recovery batch: each claim moves its next eligible attempt forward.

ALTER TABLE orders
  ADD COLUMN next_matching_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN last_matching_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN matching_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_matching_attempt_count_non_negative
  CHECK (matching_attempt_count >= 0);

CREATE INDEX idx_orders_matching_recovery_due
  ON orders ((COALESCE(next_matching_attempt_at, placed_at, created_at)), placed_at, id)
  WHERE order_status = 'searching_technician'
    AND service_zone_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION reset_order_matching_recovery()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_status = 'searching_technician'
     AND (TG_OP = 'INSERT' OR OLD.order_status IS DISTINCT FROM NEW.order_status) THEN
    NEW.next_matching_attempt_at := now();
    NEW.last_matching_attempt_at := NULL;
    NEW.matching_attempt_count := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reset_matching_recovery_on_search
  BEFORE INSERT OR UPDATE OF order_status ON orders
  FOR EACH ROW EXECUTE FUNCTION reset_order_matching_recovery();

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('matching.recovery_interval_seconds', '60', 'number', 'matching',
   'عدد الثواني بين جولات استرداد الطلبات التي ما زالت تبحث عن فني', false),
  ('matching.recovery_batch_size', '25', 'number', 'matching',
   'أقصى عدد طلبات يأخذ دوره في جولة استرداد واحدة', false),
  ('matching.recovery_initial_backoff_seconds', '60', 'number', 'matching',
   'مهلة إعادة المحاولة الأولى للطلب الذي لم يجد فنيًا؛ تتضاعف تدريجيًا لمنع حجب الطلبات الجديدة', false),
  ('matching.recovery_max_backoff_seconds', '3600', 'number', 'matching',
   'أقصى مهلة بين محاولات مطابقة الطلب العالق، بالثواني', false),
  ('matching.work_opportunity_exclusive_seconds', '7200', 'number', 'matching',
   'مدة حصرية العرض الاختياري الأول؛ بعدها يظل العرض صالحًا لكن يمكن توسيعه بالتوازي لفني آخر', false)
ON CONFLICT (key) DO NOTHING;

CREATE INDEX idx_work_opportunities_exclusive_offer
  ON technician_work_opportunities (order_id, offered_at DESC)
  WHERE status = 'offered' AND context = 'assignment' AND deleted_at IS NULL;

COMMENT ON COLUMN orders.next_matching_attempt_at IS
  'موعد استحقاق محاولة المطابقة التالية؛ يمنع الطلبات العالقة القديمة من احتكار دفعات الاسترداد.';
COMMENT ON COLUMN orders.matching_attempt_count IS
  'عدد محاولات الاسترداد المتتالية منذ دخول الطلب حالة searching_technician، لاستخدام backoff متدرج.';
