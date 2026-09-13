-- حافز InstaPay (طلب مالك 2026-09-13).
--
-- الخصم يُسجّل كجزء من discount_amount_cents حتى تدخل التقارير والعمولات في نفس الحقيقة،
-- لكن عموده المنفصل يجعل إلغاء تحويل InstaPay المرفوض يعيد الحافز وحده بلا مساس بكوبون أو
-- خصم عمارة على نفس الطلب.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS instapay_discount_cents integer NOT NULL DEFAULT 0;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_instapay_discount_cents_nonnegative;

ALTER TABLE orders
  ADD CONSTRAINT orders_instapay_discount_cents_nonnegative
  CHECK (instapay_discount_cents >= 0);

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.instapay_discount_egp', '0'::jsonb, 'number', 'payments',
   'خصم ثابت بالجنيه عند تأكيد العميل الدفع عبر InstaPay. صفر = لا يوجد حافز. الخصم تتحمله المنصة ولا يخصم من مستحق الفني.',
   true)
ON CONFLICT (key) DO NOTHING;
