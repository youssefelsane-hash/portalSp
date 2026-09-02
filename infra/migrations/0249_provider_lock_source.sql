-- baytak — 0249: ADR-0066 §1 — مصدر قفل المنفّذ.
--
-- بقى فيه طريقتين يتقفل بيهم منفّذ على طلب: تذكرة معاينة حجز (ADR-0063/0065)، واختيار منفّذ فوق
-- عرض سعر معتمد (ADR-0066). تعريف القفل القديم (`selected_match_preview_id IS NOT NULL`) بقى
-- ناقص بدل ما يبقى غلط، فالعمود ده بيسمّي المصدر بدل ما نستنتجه من أعمدة تانية.
--
-- الطلبات اللي اتقفلت قبل الـmigration دي مصدرها بالتأكيد التذكرة (المسار التاني مكانش موجود).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS provider_lock_source varchar(30);

UPDATE orders
   SET provider_lock_source = 'match_preview'
 WHERE selected_match_preview_id IS NOT NULL
   AND provider_lock_source IS NULL;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_provider_lock_source
  CHECK (provider_lock_source IS NULL OR provider_lock_source IN ('match_preview', 'post_quote_selection'));

COMMENT ON COLUMN orders.provider_lock_source IS
  'ADR-0066 §1 — إزاي اتقفل المنفّذ على الطلب: تذكرة معاينة أو اختيار بعد عرض السعر. NULL = توزيع حر.';
