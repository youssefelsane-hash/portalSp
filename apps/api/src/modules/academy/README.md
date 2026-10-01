# academy — قاعدة بيانات "الأكاديمية" (base بس، عمدًا)

## السياق

`docs/01-master-plan.md` §9.1 بيذكر "اجتياز اختبار الأكاديمية" كشرط من شروط الوصول لمستوى
Platinum، و§9.3 بيذكر "تدريب سلوكي يوم واحد" ضمن مسار قبول الفني (Funnel). الموضوع ده **مش** بند
من قايمة الـ44 بند اللي اتبنت بالكامل end-to-end (`docs/10-integration-completion-tracker.md`)،
ولا من الميزات المؤجّلة رسميًا (Favorites/تفضيلات الإشعارات/تعويض التأخير التلقائي/QR الترشيح/
تقييم Google/محرك المسار الوظيفي/باني الأدوار الديناميكي). صاحب المشروع طلب صراحة إن الموضوع ده
يتعمله **base بس دلوقتي وميتاخدش تركيز**، على إن يتوسّع لاحقًا لما الأولوية تيجي.

## اللي موجود فعلاً (migration 0072)

- `academy_courses` — كورسات/اختبارات الأكاديمية (عنوان عربي/إنجليزي، وصف، درجة النجاح
  `passing_score` افتراضي 70، ترتيب عرض، تفعيل/تعطيل، soft-delete).
- `academy_exam_attempts` — محاولة اختبار واحدة لفني معيّن في كورس معيّن (درجة، نجاح/رسوب
  محسوب تلقائيًا من `score >= course.passing_score` وقت التسجيل مش قيمة بتتبعت يدوي — عشان
  لو `passing_score` الكورس اتغيّر بعد كده، المحاولات القديمة تفضل صحيحة تاريخيًا)، مين سجّلها
  من الأدمن، وتاريخ المحاولة.
- صلاحية `academy.manage` (زي نمط `cancellation_reasons.manage`/`catalog.manage` بالحرف) —
  ممنوحة لـ`super_admin`/`ops_manager` تلقائيًا.
- `AcademyService`/`AcademyController` (`/academy/courses`, `/academy/my-exam-attempts` —
  للفني) و`AdminAcademyController` (`/admin/academy/courses`, `/admin/academy/exam-attempts`,
  `/admin/academy/technicians/:technicianId/exam-attempts` — للأدمن، CRUD كورسات + تسجيل نتيجة
  اختبار). كل الـ`create`/`update`/تسجيل نتيجة بيتسجّل في `audit_logs`.

## اللي **مش** موجود عمدًا (ده الفرق بين "base" و"نظام تدريب كامل")

- **مفيش أي ربط تلقائي بمنطق الترقية/`quality_score`** الموجود في `technicians` module (شرط
  Platinum في `docs/01-master-plan.md` §9.1 لسه مش متفعّل كودياً). ربط اجتياز الأكاديمية بمنطق
  الترقية الفعلي قرار عمل محتاج تفاصيل مش موجودة في القاموس: هل هو شرط صارم يمنع الترقية لو مش
  مُجتاز؟ نافذة صلاحية (لازم يتعاد كل قد إيه)؟ نفس مبدأ باقي "الفجوات الموثّقة صراحة، مش سهو" في
  المشروع ده — مش هنخترعه.
- **مفيش محرك اختبارات تفاعلي** (أسئلة/إجابات/تصحيح تلقائي) — تسجيل النتيجة يدوي من الأدمن بس
  (زي ما بيحصل فعليًا في تدريب حقيقي: امتحان ورقي/عملي، النتيجة بتتسجّل يدوي).
- **مفيش شاشة أدمن ولا `apps/technician-app`** بتستخدم الـendpoints دي لسه — الاستخدام حاليًا
  عبر الـAPI مباشرة (curl/Postman) بس. لما الأولوية تيجي، الشاشات دي إضافة UI بحتة على schema
  جاهزة بالفعل (نفس نمط باقي الميزات في المشروع ده اللي كان الباك-إند فيها جاهز قبل الواجهة).
- **مفيش `packages/shared-types`** لأنواع الاستجابة هنا — هيتضاف لما `apps/admin`/
  `apps/technician-app` يبنوا شاشات فعلية تستخدمها.

## اتأكد إزاي

`npx tsc --noEmit` + `npx nest build` + `npx jest` في `apps/api` عدّوا كلهم نضيف بعد إضافة
الموديول ده. اتأكد حي عبر curl ضد Postgres حقيقي: كورس اتعمل (`POST /admin/academy/courses`)،
ظهر في `GET /admin/academy/courses` و`GET /academy/courses` (فني)، محاولة اختبار اتسجلت
(`POST /admin/academy/exam-attempts`) بدرجة أقل من `passing_score` → `passed:false` تلقائيًا،
ودرجة أعلى → `passed:true`، وظهرت في `GET /admin/academy/technicians/:id/exam-attempts` وفي
`GET /academy/my-exam-attempts` بتاع نفس الفني. بيانات الاختبار (كورس + محاولتين) اتحذفت بعد
التأكيد.

## الأكاديمية بقت جزء من دورة الفني: كورس إلزامي + امتحان + إعادة تدريب (ADR-0117، migration 0375، 2026-09-30)

- **مفيش منصة تدريب جديدة** — نفس الجداول اتمدت: `academy_courses` (`course_key`، `lesson_ar`، `quiz_questions`
  JSONB، `is_mandatory_onboarding`)، `academy_exam_attempts` (`source` = `admin`/`self`، `answers`)،
  و`technician_profiles` (`retraining_required_at`، `retraining_reason`).
- **كورس مزروع**: «التعامل مع العميل وسياسة أسطة» — الالتزام، الاحترام والنظافة، السعر والتحصيل، جوّه البيت،
  التصوير، الشكوى والضمان + ٨ أسئلة (النجاح 80٪ ⇒ ٧/٨).
- **الامتحان من التطبيق**: `POST /academy/courses/:id/attempts {answers}` — التصحيح هنا بس (`gradeQuiz`)، والـ
  `correct_index` مابيطلعش أبدًا (`publicQuestions`). محدود بـ10 محاولات/ساعة. `GET /academy/onboarding-status`.
- **الاعتماد**: `academy-onboarding.ts` → `loadOnboardingStatus()` (SQL بلا حقن، عشان `admin-technicians.service`
  يقراه من غير دورة استيراد). البوابة `academy.onboarding_gate_enabled` **مقفولة افتراضيًا**: الموظف بيشوف «ناجح ✓/لسه»
  في صفحة الفني. لما تتفتح: اعتماد عادي ⇒ 409، و`override_reason` من super_admin بس (≥10 حروف) بيتسجّل في
  ملاحظات الاعتماد وفي audit `technician.academy_gate_overridden`.
- **إعادة التدريب** (`academy-retraining.listener.ts`): شكوى `rude_behavior` اتحلّت بإجراء (مش `no_action`)، أو تقييم
  احترافية ≤ `academy.retraining_professionalism_threshold` (2) ⇒ علامة مرة واحدة + إشعار للفني (`/technician/academy`)
  وللعمليات (`technician.retraining_required`). **مش إيقاف**. النجاح **بعد** العلامة بيشيلها لوحده.
- تطبيق الفني: `academy_course_screen.dart` (الدرس + الاختبار، تمرير لأول سؤال ناقص)، بانر في شاشة استكمال
  البيانات، وشارة «إلزامي»/«ناجح» في الأكاديمية.
- الاختبارات: `academy-onboarding.spec.ts` (8 على Postgres: الأسئلة من غير الإجابات، التصحيح، الدورة كاملة،
  إعادة التدريب بالشكوى وبالتقييم، والبوابة بالـoverride)، و`test/academy_course_quiz_test.dart` في التطبيق.
