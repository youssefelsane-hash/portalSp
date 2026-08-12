-- baytak (صُنّاع) — 0063: تحسينات التقييم المتقدم (docs/08 §9)
-- بُعد "النظافة" ناقص فعلاً (مش عمود راكد هنا، أول مرة) + ربط صور "بعد التنفيذ" مباشرة بصف
-- التقييم نفسه (order_media كان مستقل تمامًا عن ratings من قبل — بدون rating_id).
ALTER TABLE ratings ADD COLUMN cleanliness_rating SMALLINT NULL CHECK (cleanliness_rating BETWEEN 1 AND 5);

ALTER TABLE order_media ADD COLUMN rating_id UUID NULL REFERENCES ratings(id);
CREATE INDEX idx_order_media_rating_id ON order_media(rating_id) WHERE rating_id IS NOT NULL;
