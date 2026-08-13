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
