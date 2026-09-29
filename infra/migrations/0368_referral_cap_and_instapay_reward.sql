-- Add the customer referral cap without changing existing rewards until the owner sets a limit.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'referral.max_monthly_reward_cents_per_customer',
  '0'::jsonb,
  'number',
  'referral',
  'أقصى قيمة أكواد مكافآت الترشيح الصادرة للعميل خلال الشهر بالقرش (صفر = بلا سقف). اضبطه قبل الإطلاق.',
  false
)
ON CONFLICT (key) DO NOTHING;

-- Align a previously registered, disabled-by-default setting so the admin settings audit stays green.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES (
  'orders.require_phone_verification_on_first_order',
  'false'::jsonb,
  'boolean',
  'security',
  'يطلب من العميل تأكيد رقمه بكود SMS عند أول طلب بس (محتاج مزوّد SMS مُجهّز). مقفول = أي حد يطلب بأي رقم.',
  false
)
ON CONFLICT (key) DO NOTHING;

-- Keep the owner's configured amount intact; it now acts as the cap on a five-percent reward.
UPDATE settings
SET description = 'الحد الأقصى بالجنيه لمكافأة 5% عند الدفع عبر InstaPay. صفر = لا توجد مكافأة. المنصة تتحملها ولا تخصم من مستحق الفني.'
WHERE key = 'payments.instapay_discount_egp';
