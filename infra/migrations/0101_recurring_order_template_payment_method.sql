-- baytak — 0101: payment_method لقوالب الطلبات المتكررة (docs/08 §19 بند 6، تدقيق جاهزية الإطلاق)
-- recurring_order_templates كانت بلا أي عمود payment_method — RecurringOrdersService.generateFromTemplate()
-- كانت بتبني CreateOrderDto بدون payment_method خالص، يعني كل طلب متولّد من قالب متكرر كان
-- non-prepaid دايمًا مهما كان العميل عايز يدفع كارت/InstaPay مقدّمًا (يكسر قاعدة الدفع-قبل-التوزيع،
-- ADR-0013، لأي قالب متكرر). العمود ده اختياري (NULL = زي زمان، دفع بعد الشغل عبر كاش/محفظة) —
-- نفس قيم CreateOrderDto.payment_method بالظبط (card/instapay بس، الطرق التانية مالهاش معنى prepay).
ALTER TABLE recurring_order_templates
  ADD COLUMN payment_method payment_method NULL
    CONSTRAINT chk_recurring_order_templates_payment_method CHECK (payment_method IN ('card', 'instapay'));
