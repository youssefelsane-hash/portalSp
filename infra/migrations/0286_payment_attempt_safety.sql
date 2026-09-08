-- نتائج الدفع غير المحسومة لا تعتبر رفضًا: الموظف يراجعها قبل أي تحصيل أو رد جديد.
ALTER TYPE payment_gateway_status ADD VALUE IF NOT EXISTS 'manual_review';

-- لا نملأ الحاجز للصفوف القديمة تلقائيًا: قد تحتوي البيئة على محاولات قديمة متزامنة،
-- وتحويلها صامتًا إلى قرار مالي ليس آمنًا. الكود يفحصها قبل إنشاء أي محاولة جديدة.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS active_order_payment_guard VARCHAR(96) NULL;

-- الطلب الأصلي له محاولة بوابة نشطة واحدة فقط. NULL يسمح بالسجل التاريخي وبالدفعات
-- الإضافية/الأقساط التي لا تستعمل الحاجز أصلًا.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_active_order_payment_guard
  ON payments (active_order_payment_guard)
  WHERE active_order_payment_guard IS NOT NULL;

-- تذكير الكاش يُطالب به أولًا ثم يصبح "مرسلًا" بعد إنشاء إشعار العميل، لا قبل ذلك.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS recurring_cash_reminder_claimed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_orders_recurring_cash_reminder_claim
  ON orders (recurring_cash_reminder_claimed_at, scheduled_at)
  WHERE order_type = 'recurring'
    AND recurring_cash_reminder_sent_at IS NULL;
