-- كود الخصم هو نقطة الإدارة الوحيدة للعروض والإسناد. الخصم والعمولة مساران ماليان منفصلان:
-- discount/spent_cents يخص العميل داخل transaction الطلب، والعمولة الخارجية لا تُدفع تلقائيًا.

ALTER TABLE promo_codes
  ADD COLUMN discount_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN marketing_channel varchar(30),
  ADD COLUMN marketing_region_label varchar(120),
  ADD COLUMN marketing_notes text,
  ADD COLUMN payout_per_completed_order_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN payout_contact_name varchar(120),
  ADD COLUMN payout_contact_phone varchar(20);

CREATE TABLE promo_code_marketing_commissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status varchar(20) NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'paid', 'cancelled')),
  accrued_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payment_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_promo_code_marketing_commissions_code_status
  ON promo_code_marketing_commissions (promo_code_id, status, accrued_at DESC);

-- نقل المصادر القديمة إلى صفوف promo_codes. المصدر السابق الذي لا يمنح خصمًا يظل قابلًا للقياس
-- لكن validateAndApply يرفض استخدامه كخصم؛ أما أي كود مطابق موجود مسبقًا فيتم إثراؤه فقط.
INSERT INTO promo_codes (
  code, name_ar, discount_type, discount_value, min_order_amount_cents,
  usage_limit_per_user, valid_from, valid_until, is_active, created_by_user_id,
  discount_enabled, marketing_channel, marketing_region_label, marketing_notes,
  payout_per_completed_order_cents, payout_contact_name, payout_contact_phone
)
SELECT
  s.code, s.name_ar, 'percentage'::discount_type, 0, 0,
  1, s.created_at, '2099-12-31T23:59:59.999Z'::timestamptz, s.is_active,
  COALESCE(s.created_by_user_id, (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)),
  false, s.channel, s.region_label, s.notes,
  s.payout_per_completed_order_cents, s.payout_contact_name, s.payout_contact_phone
FROM marketing_sources s
WHERE s.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM promo_codes p WHERE p.code = s.code);

UPDATE promo_codes p
   SET marketing_channel = COALESCE(p.marketing_channel, s.channel),
       marketing_region_label = COALESCE(p.marketing_region_label, s.region_label),
       marketing_notes = COALESCE(p.marketing_notes, s.notes),
       payout_per_completed_order_cents = CASE
         WHEN p.payout_per_completed_order_cents = 0 THEN s.payout_per_completed_order_cents
         ELSE p.payout_per_completed_order_cents
       END,
       payout_contact_name = COALESCE(p.payout_contact_name, s.payout_contact_name),
       payout_contact_phone = COALESCE(p.payout_contact_phone, s.payout_contact_phone)
  FROM marketing_sources s
 WHERE s.deleted_at IS NULL AND p.code = s.code;

-- الأرقام التاريخية لا تضيع: الروابط القديمة تظل قابلة للقياس تحت الكود الموحد.
INSERT INTO promo_code_link_hits (id, promo_code_id, platform, occurred_at)
SELECT h.id, p.id, h.platform, h.occurred_at
  FROM marketing_link_hits h
  JOIN marketing_sources s ON s.id = h.source_id
  JOIN promo_codes p ON p.code = s.code
ON CONFLICT (id) DO NOTHING;

INSERT INTO promo_code_link_attributions (id, user_id, promo_code_id, attributed_at, created_at)
SELECT a.id, a.user_id, p.id, a.attributed_at, a.created_at
  FROM marketing_attributions a
  JOIN marketing_sources s ON s.id = a.source_id
  JOIN promo_codes p ON p.code = s.code
 WHERE a.deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO promo_code_marketing_commissions (
  id, promo_code_id, order_id, customer_user_id, amount_cents, status,
  accrued_at, paid_at, paid_by_user_id, payment_note, created_at, updated_at
)
SELECT c.id, p.id, c.order_id, c.customer_user_id, c.amount_cents, c.status,
       c.accrued_at, c.paid_at, c.paid_by_user_id, c.payment_note, c.created_at, c.updated_at
  FROM marketing_source_commissions c
  JOIN marketing_sources s ON s.id = c.source_id
  JOIN promo_codes p ON p.code = s.code
 WHERE c.deleted_at IS NULL
ON CONFLICT (order_id) DO NOTHING;
