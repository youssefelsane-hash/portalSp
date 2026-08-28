-- baytak — 0217: المساعد دور على الشخص مش لافتة على الطلب (ADR-0050، docs/08 §94، طلب مالك مباشر)
--
-- قبل ده: كلمة "مساعد" كانت موجودة بس في `order_team_members.member_type` — يعني لافتة بتتحدد
-- وقت الإضافة حسب اللي بيضيف، مش صفة على الشخص. النتيجة إن نفس الناس بيظهروا في قايمة الفنيين
-- وقايمة المساعدين، ومساعد عديم الخبرة يقدر يتوزّعله طلب كامل لوحده كقائد، ونفس الشخص ممكن ياخد
-- 100% من الحصة في طلب و65% في طلب تاني حسب إزاي حد ضمّه.
--
-- الافتراضي 'technician' عمدًا: كل الفنيين الموجودين يفضلوا بالظبط زي ما هم، صفر تغيير سلوكي لأي
-- حد لحد ما الأدمن يغيّر حد صراحةً (طلب مالك صريح: "لما هو يكون محطوط على فني البروسيس ماشية
-- عادي جدًا زي ما هي دلوقتي، مفيش أي اختلاف").
--
-- enum مش boolean: نفس سابقة technician_pricing_tier (0162) — `technician_kind = 'assistant'`
-- بيقرا نفسه في الاستعلامات أوضح من `is_assistant = true`، وبيسيب الباب مفتوح لدور تالت لاحقًا.
--
-- مفيش أعمدة _at/_by على الصف (بعكس علامة التوثيق 0194): audit_logs بيسجّل مين غيّر وإمتى بالكامل،
-- وتكرار نفس الحقيقة على الصف بيخلق مصدرين ممكن يختلفوا. قرار مقصود موثّق في ADR-0050.

DO $$ BEGIN
  CREATE TYPE technician_kind AS ENUM ('technician', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE technician_profiles
  ADD COLUMN IF NOT EXISTS technician_kind technician_kind NOT NULL DEFAULT 'technician';

COMMENT ON COLUMN technician_profiles.technician_kind IS
  'ADR-0050: دور الشخص نفسه. technician = فني كامل (توزيع/اختيار عميل/قيادة طلب مسموح). assistant = مساعد بس (ما يظهرش في أي قايمة فنيين، وما يقودش طلب أبدًا، وبياخد نسبة المساعد دايمًا في توزيع الحصص). الأدمن بيغيّرها في الاتجاهين — الترقية بتأثر على الشغل الجديد بس، الحصص القديمة snapshot ثابت.';

-- الاستعلامات بتفلتر على (kind + verification_status + deleted_at) مع بعض في كل مسارات الأهلية.
CREATE INDEX IF NOT EXISTS idx_technician_profiles_kind
  ON technician_profiles (technician_kind)
  WHERE deleted_at IS NULL;
