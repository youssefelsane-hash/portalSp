-- baytak — 0093: استرداد جزئي حقيقي عبر البوابة (ADR-0013 §9، توجيه المالك 2026-08-14)
-- عمود جديد لتخزين مرجع الاسترداد الحقيقي عند البوابة (Paymob refund id مثلاً) — null لو
-- الاسترداد اتعمل عبر رصيد محفظة بس (مفيش بوابة بتدعم refund حقيقي لطريقة الدفع دي).
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider_refund_id VARCHAR(120);
