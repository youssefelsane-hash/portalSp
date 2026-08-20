-- baytak (صُنّاع) — 0150: دمج تدفق دفع InstaPay اليدوي الموجود مع حجوزات الخدمات المنزلية
-- (توجيه صريح من المالك 2026-08-20) — القرار الكامل وأسبابه في
-- docs/adr/0019-domestic-worker-instapay-payment.md.

-- حالة جديدة: الشغالة وافقت على الحجز لكن الدفع لسه معلّق. القيمة الجديدة متستخدمش في نفس
-- transaction الإضافة (قيد Postgres على ALTER TYPE ... ADD VALUE) — الاستخدام الفعلي من كود
-- التطبيق بعد كده بس.
ALTER TYPE domestic_worker_booking_status ADD VALUE 'awaiting_payment';

-- توقيت موافقة الشغالة الفعلي (منفصل عن confirmed_at اللي معناها بقى "الدفع اتأكد إداريًا" —
-- إعادة تعريف دلالي للعمود الموجود، مفيش migration للعمود نفسه لأنه من أول يوم).
ALTER TABLE domestic_worker_bookings ADD COLUMN accepted_at TIMESTAMPTZ NULL;

-- "الفترة المستهدفة" وقت ما الحجز/التجديد في awaiting_payment — بتتحول لـcurrent_period_end_at
-- بس لما InstaPay تتأكد (شهري بس، حجز بالساعة معندوش فترات).
ALTER TABLE domestic_worker_bookings ADD COLUMN pending_period_end_at TIMESTAMPTZ NULL;

-- توسيع جدول payments (نفس الجدول المستخدم لكل دفعات orders) عشان يقدر يشير لحجز خدمة منزلية
-- بدل طلب — mutually exclusive عبر CHECK، مش تكرار جدول موازي (docs/adr/0019).
ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN domestic_worker_booking_id UUID NULL REFERENCES domestic_worker_bookings(id);
ALTER TABLE payments ADD CONSTRAINT payments_exactly_one_payable_reference_chk
  CHECK ( (order_id IS NOT NULL)::int + (domestic_worker_booking_id IS NOT NULL)::int = 1 );
CREATE INDEX idx_payments_domestic_worker_booking_id ON payments(domestic_worker_booking_id)
  WHERE domestic_worker_booking_id IS NOT NULL;

-- نفس التعميم بالظبط على refunds (استرداد حجز خدمة منزلية بعد دفع InstaPay مؤكّد).
ALTER TABLE refunds ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN domestic_worker_booking_id UUID NULL REFERENCES domestic_worker_bookings(id);
ALTER TABLE refunds ADD CONSTRAINT refunds_exactly_one_payable_reference_chk
  CHECK ( (order_id IS NOT NULL)::int + (domestic_worker_booking_id IS NOT NULL)::int = 1 );
CREATE INDEX idx_refunds_domestic_worker_booking_id ON refunds(domestic_worker_booking_id)
  WHERE domestic_worker_booking_id IS NOT NULL;
