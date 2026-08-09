-- baytak — 0049: نظام الترشيحات (Referral System)
-- القاعدة المتفق عليها: كل 10 ترشيحات مكتملة (المُرشَّح كمّل أول طلب فعلي، مش مجرد تسجيل) =
-- كود خصم مكافأة للمُرشِّح (عبر نظام promo_codes الموجود أصلاً — راجع referrals.service.ts).
-- users.referral_code و users.referred_by_user_id كانوا موجودين من migration 0003 بس مش
-- مستخدمين لحد دلوقتي (راجع auth.service.ts للتفعيل).

CREATE TYPE referral_status AS ENUM ('pending', 'completed');

CREATE TABLE referrals (
  id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  referrer_user_id    UUID              NOT NULL REFERENCES users(id),
  referred_user_id    UUID              NOT NULL UNIQUE REFERENCES users(id),
  status              referral_status   NOT NULL DEFAULT 'pending',
  completed_at        TIMESTAMPTZ       NULL,
  reference_order_id  UUID              NULL REFERENCES orders(id),
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ       NULL
);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_referrals_status ON referrals(status) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
