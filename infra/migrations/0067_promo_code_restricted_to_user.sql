-- baytak (صُنّاع) — 0067: تقييد كود الخصم بمستخدم واحد (إصلاح أمني حقيقي)
-- فجوة كانت موثّقة صراحة في referrals.service.ts's issueReward(): مكافأة الترشيح كانت بتتصدر
-- كـ promo_codes عادي بلا أي قيد فعلي يمنع غير المُرشِّح من استخدامها — الحماية الوحيدة كانت
-- "الكود بيتوصّل بس عبر إشعار خاص"، يعني أي حد يعرف الكود (تسريب، مشاركة، لقطة شاشة) يقدر
-- يستخدمه. العمود ده بيقفل الثغرة دي فعليًا على مستوى الداتابيز نفسه، مش مجرد تعليق توثيقي.
ALTER TABLE promo_codes ADD COLUMN restricted_to_user_id UUID NULL REFERENCES users(id);
CREATE INDEX idx_promo_codes_restricted_to_user_id ON promo_codes(restricted_to_user_id) WHERE restricted_to_user_id IS NOT NULL;
