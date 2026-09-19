-- فئة تسعير رابعة: مبتدئ ← قياسي ← **متقدم** ← خبير (طلب مالك 2026-09-19، docs/08 §170).
--
-- التلات فئات كانت بتدّي الأدمن تحكّم خشن في السعر اللي العميل بيشوفه: قفزة واحدة بين القياسي
-- والخبير. الفئة الرابعة بتدّي درجة وسطية، فالفني اللي أحسن من القياسي ولسه مش خبير يتسعّر صح
-- بدل ما يتحط في واحدة من الاتنين غصب.
--
-- **الترتيب جزء من المعنى**: `enumsortorder` هو اللي الواجهات بترتّب بيه الفئات، فـ`advanced`
-- لازم تقع بين `standard` و`expert` مش في الآخر. `ALTER TYPE ... ADD VALUE ... BEFORE` مش
-- ممكنة هنا لأن الـmigrations بتتنفّذ جوّه transaction والقيمة الجديدة بتتستخدم في نفس الملف —
-- فنفس أسلوب 0316 بالحرف: إعادة إنشاء النوع بالترتيب الصح.

ALTER TABLE technician_profiles
  ALTER COLUMN pricing_tier DROP DEFAULT,
  ALTER COLUMN pricing_tier TYPE text USING pricing_tier::text;

ALTER TABLE service_pricing_tier_pricing
  ALTER COLUMN pricing_tier TYPE text USING pricing_tier::text;

ALTER TYPE technician_pricing_tier RENAME TO technician_pricing_tier_pre_advanced;
CREATE TYPE technician_pricing_tier AS ENUM ('beginner', 'standard', 'advanced', 'expert');

-- تحويل هوية خالص: مفيش صف بيتغيّر تصنيفه، الفئة الجديدة فاضية لحد ما الأدمن يعيّن فيها حد.
ALTER TABLE technician_profiles
  ALTER COLUMN pricing_tier TYPE technician_pricing_tier USING pricing_tier::technician_pricing_tier,
  ALTER COLUMN pricing_tier SET DEFAULT 'standard'::technician_pricing_tier;

ALTER TABLE service_pricing_tier_pricing
  ALTER COLUMN pricing_tier TYPE technician_pricing_tier USING pricing_tier::technician_pricing_tier;

DROP TYPE technician_pricing_tier_pre_advanced;

-- **مضاعف «متقدم» بيبدأ من نفس القياسي، مش من متوسط بينه وبين الخبير.**
-- ده قرار مالي محافظ عن قصد: أي صف جديد بمضاعف أعلى معناه زيادة سعر **فورية** على كل خدمة
-- من غير ما حد يقررها. الأدمن بيرفعه بنفسه من شاشة الخدمة لما يحدد قيمته. نفس السابقة بالحرف
-- لما `beginner` اتضافت في 0316.
INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier, is_active)
SELECT standard.service_id, 'advanced'::technician_pricing_tier, standard.price_multiplier, standard.is_active
FROM service_pricing_tier_pricing standard
WHERE standard.pricing_tier = 'standard'::technician_pricing_tier
  AND NOT EXISTS (
    SELECT 1 FROM service_pricing_tier_pricing existing
    WHERE existing.service_id = standard.service_id
      AND existing.pricing_tier = 'advanced'::technician_pricing_tier
  );
