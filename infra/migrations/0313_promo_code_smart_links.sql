-- روابط وQR أكواد الخصم العادية. الكود يظل صالحًا بنفس قواعد `promo_codes` الحالية؛
-- الجداول دي تقيس رحلة الرابط فقط (زيارة → تسجيل)، ولا تمنح خصمًا ولا تغيّر الرصيد بنفسها.

CREATE TABLE promo_code_link_hits (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  platform varchar(10) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_promo_code_link_hit_platform CHECK (platform IN ('android', 'ios', 'web', 'other'))
);

CREATE INDEX idx_promo_code_link_hits_promo_time
  ON promo_code_link_hits (promo_code_id, occurred_at DESC);

-- أول رابط كود خصم وصل للزائر قبل ما ينشئ حسابه هو اللي يتسجل. ده attribution تحليلي فقط:
-- يظل العميل حرًا في استخدام أي كود صالح عند الحجز، ولا يتحول الرابط لقيد خصم مخفي.
CREATE TABLE promo_code_link_attributions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  attributed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_promo_code_link_attributions_promo
  ON promo_code_link_attributions (promo_code_id, attributed_at DESC);
