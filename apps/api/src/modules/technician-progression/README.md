# modules/technician-progression

محرك المسار الوظيفي/الترقي للفني (docs/11 §4 — طلب صريح من المالك، 2026-08-13). جداول:
`technician_progression_rules`, `technician_progression_status` (`infra/migrations/0084`).

**الحالة: شغال بالكامل، مختبر حي على بيانات فنيين حقيقية.**

## إعادة استخدام السُلّم الموجود — مفيش تكرار

المشروع كان عنده بالفعل سُلّم مستويات (`technician_level` enum: `new→verified→professional→
premium→team_leader`)، `technician_profiles.current_level`، و`technician_level_history` (سجل
الترقية/التخفيض) — لكن مفيش أي جدول شروط وصول لكل مستوى، فقط `technician_level_config` اللي
بيتحكم في **مزايا** كل مستوى (عمولة/أولوية إرسال) لا **شروط الوصول** له. الموديول ده بيضيف
الطبقة الناقصة بس:

- **مفيش سُلّم جديد** — بيستخدم نفس الـ`technician_level` enum بالحرف.
- **مفيش endpoint تنفيذ ترقية جديد** — الترقية الفعلية (تحديث `current_level` + صف
  `technician_level_history`) بتحصل بنفس المنطق اللي كان موجود في
  `admin-technicians.service.ts changeLevel()`، معاد استخدامه هنا (`executePromotion()`)، مش
  إعادة اختراع.
- **مفيش تنفيذ تخفيض جديد** — لو `enable_demotion_review` مفعّلة وفني تحت العتبات، بس
  `needs_demotion_review=true` + سبب واضح بيتسجّل. **التخفيض الفعلي لسه يدوي عبر
  `PATCH /admin/technicians/:id/level` الموجود أصلاً** — الأدمن يشوف العلم هنا ويقرر يستخدم
  الـendpoint الموجود، مفيش تكرار منطق.

## قواعد الترقية — صفر عتبات مكتوبة في الكود

صف واحد لكل `from_level` (`UNIQUE`) في `technician_progression_rules`، بيحدد `to_level` +
شروط الوصول، كلها قابلة للتعديل الكامل من `PATCH /admin/technician-progression/rules/:id`
(`technician_progression.manage_rules`): أقل طلبات مكتملة، أقل إيراد للمنصة، أقل متوسط تقييم،
أقصى معدل إلغاء، أقصى شكاوى مثبتة، أقل متوسط KPI (اختياري، بيقرأ من `technician_kpi_snapshots`
— **إعادة استخدام مباشرة لمحرك الجزء التالت**)، أقل أيام نشاط، `auto_promote` (افتراضي `false`
— موافقة أدمن مطلوبة دايمًا إلا لو Super Admin فعّلها صراحة لانتقال معيّن، **طلب صريح من
المالك بالحرف**)، و`enable_demotion_review` + عتباته المنفصلة.

القيم الافتراضية المزروعة في الـmigration (10 طلبات لـnew→verified، لحد 200 طلب لـpremium→
team_leader) **قيم بداية معقولة قابلة للتغيير بالكامل**، مش نهائية.

## الحساب (`calculateAll`)

بيتنفّذ يدويًا من الأدمن (`POST /admin/technician-progression/calculate`، صلاحية
`technician_progression.manage_rules`) — مفيش cron موجود في المشروع أصلاً (`@nestjs/schedule`
مش متثبّتة)، فالتصميم اتبع نفس فلسفة "تشغيل صريح بدل أتمتة صامتة" الموجودة فعلاً في محرك
الإنتاجية الذاتي التعلّم (`service_productivity_suggestions`، migration 0077). ممكن يتحدد
فني واحد بس (`technician_id`) أو كل الفنيين المعتمدين.

**كل المقاييس "طول العمر" (all-time)، مش شهرية زي KPI** — المسار الوظيفي عن السجل التراكمي:
- طلبات مكتملة + إيراد المنصة: `orders` (`order_status='completed'`, بلا حد شهر).
- قبول العروض: `order_assignments` (`assignment_status='accepted'`, كل العمر).
- إلغاء الفني: `technician_order_cancellations` (كل العمر) — **مش** `orders.order_status`
  (نفس التحذير الموثّق في `technician-kpi/README.md`، الحالة شبه ميتة بعد سياسة إلغاء الفني).
- شكاوى مثبتة: `complaints` (`resolution_type != 'no_action'`, `complaint_status IN
  ('resolved','closed')`).
- متوسط KPI: آخر `min_kpi_months_count` سنابشوت `status IN ('approved','paid')` من
  `technician_kpi_snapshots` — لو مفيش تاريخ كافي، الشرط "غير مستوفى" (مش "متجاهَل").
- أيام النشاط: `now - (approved_at أو created_at لو approved_at فاضية)`.

**كل بُعد بيتحسب بس لو الشرط مفعّل في القاعدة** (`min_avg_rating`/`max_cancellation_rate`/
`max_upheld_complaints`/`min_avg_kpi_score` كلهم `nullable` = "مش شرط" لو `NULL`).

## سير القرار — بشري دايمًا إلا بإعداد صريح

- **مؤهّل آليًا + `auto_promote=true`** → ترقية فورية بلا تدخل أدمن (`changeType=PROMOTION`،
  `changed_by_user_id=null`).
- **مؤهّل آليًا + `auto_promote=false` (الافتراضي)** → يفضل "مؤهّل" لحد ما أدمن يعمل
  `PATCH .../approve` (`technician_progression.approve`، ينفّذ نفس الترقية).
- **مش مؤهّل آليًا بس الأدمن قرر يرقّي استثنائيًا** → `PATCH .../override`
  (`technician_progression.override`، **صلاحية أعلى منفصلة، نفس فلسفة
  `roles.grant_unrestricted`/`technician_kpi.override_max`** — `super_admin` بس بياخدها
  افتراضيًا عن طريق bypass ADR-0010) — سبب إلزامي (10-500 حرف)، `changeType=MANUAL_OVERRIDE`.
- **رفض دلوقتي** → `PATCH .../reject` — قرار مسجّل بس مش قفل نهائي (لو الفني لسه مؤهّل في
  التشغيل الجاي هيفضل ظاهر، الأدمن يقدر يوافق لاحقًا — نفس فلسفة KPI `rejected`).

## بَقّتين حقيقيتين اتلقطوا واتصلحوا وقت الاختبار الحي

1. بعد تنفيذ الترقية، `status.nextLevel` كان بيفضل بالقيمة القديمة (المستوى اللي كان "الجاي"
   قبل الترقية) بدل ما يتحدّث للمستوى الجاي **الجديد** بعد الترقية — اتلقطت بمراقبة استجابة
   `override` مباشرة (`current_level=verified` بس `next_level` لسه `verified` نفسها بدل
   `professional`). الإصلاح: `executePromotion()` بقى بيدوّر على قاعدة `from_level=newLevel`
   ويحدّث `nextLevel`/`progress` تبعًا لها.
2. مسار الترقية الآلية (`auto_promote=true`) جوّه `calculateAll()` كان بيعدّل الـ`status` في
   الذاكرة عبر `executePromotion()` بس من غير `save()` تاني بعدها — يعني التعديلات (المستوى
   الجديد، `isEligible=false`) بتضيع ومفيش حفظ في الداتابيز رغم إن الترقية الفعلية
   (`technician_profiles.currentLevel` + `technician_level_history`) كانت بتتحفظ صح. اتلقطت
   بمراجعة الكود مباشرة بعد بَقّة #1 (شكل مشابه)، اتصلحت بإضافة `await this.statuses.save(status)`
   بعد `executePromotion()` في `calculateAll()`.

**اتأكد حي بالكامل**: تفعيل `auto_promote` لقاعدة `new→verified` مع تخفيف الشروط مؤقتًا → تشغيل
الحساب → فنيين اتترقّوا آليًا فعليًا (`technician_profiles.current_level` اتغيّر، صف
`technician_level_history` جديد بـ`changeType=promotion`)، وبعد الحساب التاني `next_level`
ظهر صح (`professional` مش `verified` القديمة). اختبار سلبي: أدمن `ops_manager` (بلا
`technician_progression.override`) حاول ينفّذ override → اترفض 403. `support_agent` (بلا
`manage_rules`) حاول يعدّل قاعدة → اترفض 403. تفعيل `enable_demotion_review` بعتبة أقل من
تقييم فني حقيقي → `needs_demotion_review=true` بسبب دقيق ("متوسط التقييم (3.8) أقل من الحد
(4.00)"). فني شاف ملخّصه الشخصي (`GET /technician/progression`) وسجل ترقياته التاريخي صح.

## فجوات موثّقة صراحة

- **الأكاديمية/الشهادات المُتحقَّقة**: مؤجّلة عمدًا حسب طلب المالك الصريح ("Keep Academy/training
  integration optional and deferred — career engine must work without Academy") — مفيش أي
  عمود أو شرط متعلق بالأكاديمية هنا، مش سهو.
- **الوصول في الوقت/الإنتاجية مقابل المتوقع**: نفس الاستبعاد الموثّق في
  `technician-kpi/README.md` (البيانات مش مسجّلة بما يكفي) — الفني الوظيفي بيعتمد بس على أبعاد
  KPI الموجودة فعليًا لو الأدمن فعّل شرط `min_avg_kpi_score`.
