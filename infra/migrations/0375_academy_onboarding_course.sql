-- Osta — 0375: كورس إلزامي في الأكاديمية الحالية + بوابة اعتماد (مقفولة افتراضيًا) + إعادة تدريب
-- (ADR-0117، docs/08 §189 بند D-3). امتداد لجداول 0072 — مفيش منصة تدريب جديدة.

ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS course_key VARCHAR(60) NULL;
ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS lesson_ar TEXT NULL;
ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS quiz_questions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE academy_courses ADD COLUMN IF NOT EXISTS is_mandatory_onboarding BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_academy_courses_course_key
  ON academy_courses (course_key) WHERE course_key IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN academy_courses.quiz_questions IS
  '[{id, prompt_ar, options_ar[], correct_index}] — correct_index مابيطلعش للتطبيق أبدًا؛ التصحيح في السيرفر (ADR-0117).';

ALTER TABLE academy_exam_attempts ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'admin';
ALTER TABLE academy_exam_attempts ADD COLUMN IF NOT EXISTS answers JSONB NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_academy_exam_attempts_source') THEN
    ALTER TABLE academy_exam_attempts ADD CONSTRAINT chk_academy_exam_attempts_source CHECK (source IN ('admin', 'self'));
  END IF;
END $$;

ALTER TABLE technician_profiles ADD COLUMN IF NOT EXISTS retraining_required_at TIMESTAMPTZ NULL;
ALTER TABLE technician_profiles ADD COLUMN IF NOT EXISTS retraining_reason VARCHAR(200) NULL;

INSERT INTO settings (key, value, value_type, group_name, description, is_public)
VALUES
  ('academy.onboarding_gate_enabled', 'false'::jsonb, 'boolean', 'security',
   'اعتماد فني جديد يتطلب نجاحه في كورسات الأكاديمية الإلزامية. مقفول: الموظف بيشوف الحالة بس. مفتوح: الاعتماد العادي بيترفض، وsuper_admin بس يعدّي بسبب مكتوب (ADR-0117).',
   false),
  ('academy.retraining_professionalism_threshold', '2'::jsonb, 'number', 'security',
   'تقييم «الاحترافية» من العميل عند الرقم ده أو أقل بيطلب من الفني إعادة الكورس الإلزامي (مش إيقاف). 0 = معطّل.',
   false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO notification_type_configs (notification_type, priority_tier, default_channels, sound_key, is_actionable)
VALUES
  ('academy_retraining_required', 'action_required', '["in_app","push"]'::jsonb, NULL, false),
  ('technician_retraining_required_ops', 'informational', '["in_app","push"]'::jsonb, NULL, false)
ON CONFLICT (notification_type) DO NOTHING;

INSERT INTO notification_routing_rules (event_type, role_name, channels)
VALUES ('technician.retraining_required', 'ops_manager', '["in_app"]')
ON CONFLICT (event_type, role_name) DO NOTHING;

INSERT INTO academy_courses
  (course_key, title_ar, title_en, description_ar, passing_score, display_order, is_active, is_mandatory_onboarding, lesson_ar, quiz_questions)
SELECT
  'customer_conduct_policy',
  'التعامل مع العميل وسياسة أسطة',
  'Customer conduct & Osta policy',
  'كورس إلزامي قصير قبل ما تبدأ شغل: الالتزام، الاحترام، السعر، والتعامل جوّه البيت. بعده اختبار ٨ أسئلة.',
  80, 0, true, true,
  $lesson$١. الالتزام بالمواعيد
• اتحرّك بدري بما يكفي، وحدّث حالتك في التطبيق («في الطريق» ثم «وصلت»).
• لو هتتأخر، بلّغ العميل من التطبيق قبل الموعد — ماتسيبوش يستنى من غير كلمة.

٢. الاحترام والنظافة
• لبس نظيف، وسلام محترم، وصوت هادي حتى لو العميل متعصّب.
• لو المشكلة كبرت، ماتردّش بنفس الأسلوب — كلّم الدعم من التطبيق.

٣. السعر والتحصيل
• السعر اللي في التطبيق هو السعر. ممنوع تغيّره من غير موافقة العميل من التطبيق.
• أي شغل أو قطع زيادة تتضاف كبند إضافي من التطبيق، والعميل يوافق عليها قبل ما تنفّذ.
• ممنوع تحصّل أي مبلغ غير الرقم المتفق عليه في التطبيق، وممنوع «إكرامية مشروطة».

٤. جوّه البيت
• ادخل المكان اللي فيه الشغل بس، وحافظ على الأثاث والأرضيات.
• نضّف مكان الشغل قبل ما تمشي، وماتسيبش مخلفات.

٥. التصوير
• صوّر الشغل نفسه قبل وبعد من التطبيق — مش البيت ولا الناس.

٦. الشكوى والضمان
• أي شكوى بتتراجع بعدل، والتقييم بيأثر على أولويتك في الطلبات.
• الشغل عليه ضمان: إعادة الزيارة تحت الضمان بتتعمل من التطبيق من غير أي فلوس إضافية.
• كل الحجوزات من خلال التطبيق — ممنوع تتفق مع العميل برّاه.$lesson$,
  $quiz$[
    {"id": "q1", "prompt_ar": "العميل طلب شغل زيادة مش موجود في الطلب. تعمل إيه؟",
     "options_ar": ["أعمله وآخد فلوسه كاش على جنب", "أضيفه بند إضافي من التطبيق وأستنى موافقة العميل", "أرفض وأمشي"], "correct_index": 1},
    {"id": "q2", "prompt_ar": "عرفت إنك هتتأخر ٢٠ دقيقة عن الموعد. الصح إيه؟",
     "options_ar": ["ماقولش حاجة وأوصل وخلاص", "أبلّغ العميل من التطبيق قبل الموعد وأحدّث حالتي", "ألغي الطلب"], "correct_index": 1},
    {"id": "q3", "prompt_ar": "العميل عايز يدفع رقم غير اللي في التطبيق:",
     "options_ar": ["آخد اللي يدّيهولي", "أزوّد عشان المواصلات", "أحصّل الرقم اللي في التطبيق بالظبط"], "correct_index": 2},
    {"id": "q4", "prompt_ar": "جوّه بيت العميل:",
     "options_ar": ["أحافظ على المكان وأنضّف مكان الشغل قبل ما أمشي", "أسيب المخلفات للعميل", "أدخل أي أوضة أحتاجها"], "correct_index": 0},
    {"id": "q5", "prompt_ar": "التصوير في الطلب بيكون لإيه؟",
     "options_ar": ["للبيت كله", "للشغل نفسه قبل وبعد من التطبيق", "ماينفعش أصوّر خالص"], "correct_index": 1},
    {"id": "q6", "prompt_ar": "العميل اتعصّب عليك بصوت عالي:",
     "options_ar": ["أرد عليه بنفس الأسلوب", "أسيب الشغل وأمشي", "أفضل هادي ومحترم، ولو كبرت أكلّم الدعم من التطبيق"], "correct_index": 2},
    {"id": "q7", "prompt_ar": "العميل رجع يشتكي من نفس الشغل خلال فترة الضمان:",
     "options_ar": ["إعادة الزيارة تحت الضمان من التطبيق من غير فلوس زيادة", "آخد فلوس على الزيارة التانية", "الضمان على حسب مزاجي"], "correct_index": 0},
    {"id": "q8", "prompt_ar": "العميل قالّك «المرة الجاية كلّمني على طول من غير التطبيق وخصملي»:",
     "options_ar": ["أدّيله رقمي", "كل الحجوزات من التطبيق — أعتذر بلطف", "أوافق المرة دي بس"], "correct_index": 1}
  ]$quiz$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM academy_courses WHERE course_key = 'customer_conduct_policy' AND deleted_at IS NULL);
