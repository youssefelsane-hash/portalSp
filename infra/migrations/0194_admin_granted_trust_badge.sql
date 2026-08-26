-- ADR-0039 / docs/08 §62.1 — علامة التوثيق الزرقاء بقت مِنحة إدارية.
--
-- قبل كده: طبقة العرض كانت بتحط `isVerified: true` حرفيًا لكل صف راجع من قايمة اختيار الفني،
-- بحجة إن الفلتر فوق بيسيب `verification_status = 'approved'` بس. النتيجة إن العلامة الزرقاء
-- بتتوزّع على أي حد بيخلّص أوراقه — إشارة ثقة من غير أي ثقة وراها.
--
-- `verification_status` بتفضل زي ما هي بالظبط (أهلية تشغيلية، كل بوابات المطابقة معتمدة عليها).
-- العلامة دي مفهوم تاني تمامًا: قرار تجاري يدوي من الأدمن، وله تدقيقه الخاص.
--
-- الافتراضي `false` للكل بلا backfill — أي backfill كان هيرجّعنا لنفس المشكلة (راجع ADR-0039).

ALTER TABLE technician_profiles
  ADD COLUMN IF NOT EXISTS is_trust_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trust_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS trust_verified_by uuid NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS trust_verified_note varchar(500) NULL;

ALTER TABLE technician_companies
  ADD COLUMN IF NOT EXISTS is_trust_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trust_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS trust_verified_by uuid NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS trust_verified_note varchar(500) NULL;

COMMENT ON COLUMN technician_profiles.is_trust_verified IS
  'ADR-0039: العلامة الزرقاء في واجهة العميل. مِنحة إدارية يدوية، مستقلة تمامًا عن verification_status (الأهلية التشغيلية).';
COMMENT ON COLUMN technician_companies.is_trust_verified IS
  'ADR-0039: نفس علامة technician_profiles.is_trust_verified — الشركة كيان بيظهر في نفس قايمة الاختيار فبتاخد نفس المِنحة بنفس المسار.';

-- فهرس جزئي: الاستعلامات الوحيدة اللي بتصفّي على العمود ده هي "وريني الموثّقين بس"، والقيمة
-- المتوقعة إن الأغلبية false — ففهرس على true بس أصغر بكتير وبيغطي الاستخدام الحقيقي.
CREATE INDEX IF NOT EXISTS idx_technician_profiles_trust_verified
  ON technician_profiles (is_trust_verified) WHERE is_trust_verified = true;
