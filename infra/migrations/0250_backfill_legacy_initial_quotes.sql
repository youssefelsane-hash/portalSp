-- baytak — 0250: backfill عروض السعر للطلبات اللي وقفت على AWAITING_INITIAL_QUOTE_APPROVAL قبل 0247.
--
-- قبل ADR-0063، السعر بعد المعاينة كان بيتكتب على `orders.estimated_price_cents` مباشرة ومفيش
-- صف في `order_quotes` أصلاً (الجدول ده اتعمل في 0247). النتيجة إن أي طلب كان واقف في الحالة
-- دي وقت الترقية بقى **مستحيل يتوافق عليه**: `InspectionQuoteService.approveInitialQuote()`
-- بترمي «مفيش سعر بعد معاينة مستني الموافقة» لأنها بتدوّر على صف مش موجود.
--
-- ممنوع تعديل 0247 (متطبقة ومقفولة بـchecksum) — ده ملف جديد زي ما القاعدة بتقول.
--
-- **حدود الترحيل بصراحة**: الصف محتاج `amount_cents > 0` و`submitted_by_user_id NOT NULL`.
-- طلب واقف في الحالة دي بلا سعر مسجّل أو بلا فني معروف مالوش قيمة صادقة نكتبها، فبيتساب زي ما
-- هو وبيتقال صراحة في NOTICE بدل ما نخترعله رقم أو نربطه بمستخدم مش هو اللي سعّر.

DO $$
DECLARE
  backfilled integer;
  skipped integer;
BEGIN
  WITH candidates AS (
    SELECT o.id AS order_id,
           o.estimated_price_cents,
           COALESCE(o.initial_quote_source, 'technician_onsite') AS source,
           tp.user_id AS technician_user_id,
           COALESCE(s.quote_validity_minutes, 2880) AS validity_minutes
      FROM orders o
      JOIN services s ON s.id = o.service_id
      LEFT JOIN technician_profiles tp ON tp.id = o.technician_id
     WHERE o.order_status = 'awaiting_initial_quote_approval'
       AND o.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM order_quotes q WHERE q.order_id = o.id)
  ), inserted AS (
    INSERT INTO order_quotes (
      order_id, version, source, status, amount_cents, submitted_by_user_id, valid_until, created_at, updated_at
    )
    SELECT order_id,
           1,
           source,
           'pending_customer',
           estimated_price_cents,
           technician_user_id,
           now() + (validity_minutes || ' minutes')::interval,
           now(),
           now()
      FROM candidates
     WHERE estimated_price_cents > 0
       AND technician_user_id IS NOT NULL
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM inserted),
         (SELECT count(*) FROM candidates WHERE estimated_price_cents <= 0 OR technician_user_id IS NULL)
    INTO backfilled, skipped;

  RAISE NOTICE 'backfill عروض السعر القديمة: % صف اتعمل، % طلب اتساب (بلا سعر مسجّل أو بلا فني معروف)',
    backfilled, skipped;
END $$;
