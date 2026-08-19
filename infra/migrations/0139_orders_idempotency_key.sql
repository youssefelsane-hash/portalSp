-- Script 7 Phase 9 (Order Creation — idempotency) — بَقّة حقيقية اتلقطت: POST /orders (أهم
-- endpoint في المنصة كلها من ناحية الأثر المالي/التشغيلي — بيوزّع فني حقيقي، وبعض الحالات بتخصم
-- محفظة) كان بلا أي حماية Idempotency-Key خالص، بعكس كل عمليات الدفع (payments.controller.ts)
-- اللي بتفرض الهيدر ده صراحة (docs/01-master-plan.md §1.4). عميل بيدوس زرار "أكّد الحجز" مرتين
-- (شبكة بطيئة، double-tap، إعادة إرسال بعد timeout) كان يقدر ينشئ طلبين حقيقيين لنفس النية —
-- فني بيتوزّع مرتين، ومحفظة ممكن تتخصم مرتين لو كان دفع prepaid. نفس نمط `payments.idempotency_key`
-- بالحرف (0008_finance.sql) بس مقيّد بالعميل (partial unique index) بدل global unique — مفتاح
-- العميل بيتوّلد client-side (UUID عادة)، فالتصادم بين عملاء مختلفين نظريًا مش مستحيل زي
-- payments (اللي بتاعتها مفتاح واحد لكل عملية دفع مش لكل عميل)، فالـscoping بالعميل أدق وأسلم.
ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(80) NULL;

-- NULL مسموح (طلبات الاستدعاء الداخلي زي recurring-orders عندها حماية idempotency خاصة بيها
-- أصلاً عبر (recurring_template_id, recurring_occurrence_at) — مش محتاجة المفتاح ده) — الفريد
-- الجزئي (partial) بيسمح بأكتر من NULL لنفس العميل من غير ما يكسر القيد.
CREATE UNIQUE INDEX idx_orders_customer_idempotency_key
  ON orders (customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN orders.idempotency_key IS
  'مفتاح Idempotency-Key اختياري من هيدر الطلب (POST /orders، POST /admin/orders) — نفس مفتاح مرسل مرتين لنفس العميل يرجّع نفس الطلب الأصلي بدل ما ينشئ نسخة جديدة. NULL للمسارات الداخلية (recurring-orders) اللي عندها حماية idempotency تانية.';
