-- Script 7 Phase 31 (Database Invariants) — بَقّة حقيقية اتلقطت: wallet_transactions.amount_cents
-- عنده CHECK (amount_cents > 0) بالفعل من أول يوم، لكن الأعمدة المالية الأساسية التانية
-- (orders.total_amount_cents, payments.amount_cents, refunds.amount_cents, payouts.amount_cents/
-- net_amount_cents) مالهاش أي CHECK constraint خالص — الحماية الوحيدة كانت validation على مستوى
-- الكود (application layer) بس. ده defense-in-depth حقيقي مفقود: أي bug مستقبلي في الكود، سكريبت
-- migration غلط، أو تعديل يدوي مباشر في الداتابيز كان يقدر يسجّل مبلغ سالب بلا أي رفض من الداتابيز
-- نفسها. تأكدنا إن الصفوف الحالية كلها موجبة (0 صف سالب) قبل إضافة القيد، فالإضافة آمنة تمامًا.
ALTER TABLE orders ADD CONSTRAINT chk_orders_total_amount_cents_non_negative CHECK (total_amount_cents >= 0);
ALTER TABLE payments ADD CONSTRAINT chk_payments_amount_cents_non_negative CHECK (amount_cents >= 0);
ALTER TABLE refunds ADD CONSTRAINT chk_refunds_amount_cents_non_negative CHECK (amount_cents >= 0);
ALTER TABLE payouts ADD CONSTRAINT chk_payouts_amount_cents_non_negative CHECK (amount_cents >= 0);
ALTER TABLE payouts ADD CONSTRAINT chk_payouts_net_amount_cents_non_negative CHECK (net_amount_cents >= 0);
