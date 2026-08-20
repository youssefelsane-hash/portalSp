# ADR-0021: نموذج تكوين الطاقم (Crew Composition) + طبقة عمليات الأدمن الموحّدة

**الحالة:** معتمد
**التاريخ:** 2026-08-20

## السياق

طلب صريح جديد من المالك (2026-08-20، فوق §34 المُقفل) بعنوان "إغلاق فجوات العمل الجماعي والعمليات
الإدارية بشكل متماسك". الطلب مقسّم لـ 28 بند (رسالتين متداخلتين، نفس المضمون بصياغتين)، جوهره:

1. **فجوة العمل الجماعي**: لما طلب يحتاج أكتر من فني واحد (`required_technicians`/`required_assistants`
   موجودين من `docs/08` §5/§74)، اختيار العميل لفني واحد لازم يعني "ده القائد/المسؤول" مش "الطلب كامل
   بفني واحد". الطلب يفضل صالح والطاقم يكمل بعدين — لازم تكون حالة تشغيلية حقيقية دائمة (durable)، مش
   مجرد نص عرض.
2. **أولوية فريق القائد الحقيقي**: لو القائد عنده فريق دائم (`technician_companies`، `docs/08` §5)،
   أعضاء الفريق ده لازم يكونوا أول اختيار لإكمال الطاقم — قبل أي فني تاني — لكن **من غير تجاوز** قواعد
   الأهلية/القدرة الحقيقية (نفس النموذج المستخدم في المطابقة العادية، ADR-0018/ADR-0020).
3. **مركز عمليات أدمن حقيقي**: بدل "مفيش فني متاح" غامضة، الأدمن لازم يقدر يفهم بالظبط ليه فني معيّن
   مش بياخد شغلانة معيّنة، وليه طلب معيّن لسه بيدوّر — من نفس منطق المطابقة الحقيقي، مش خوارزمية تشخيص
   موازية في الواجهة.

مراجعة الكود الحالي (قبل أي تعديل، نفس منهج §29/§30/§31/§32) كشفت **3 أخطاء حقيقية** في الكود
الموجود فعلاً لتجنيد الفريق (`OrderTeamService`، §31)، مش بس فجوات جديدة:

- `computeCrewShortage()` بتحسب "الفريق ناقص؟" بعدد أعضاء الفريق **الكلي** بدون تفرقة فني/مساعد
  خالص، وبتتجاهل `required_assistants` تمامًا — لو طلب محتاج 3 فنيين + 2 مساعدين واتضاف مساعدين
  بس، الدالة كانت هتقول "الفريق كامل" غلط.
- `OrderTeamService.recruitMember()` بيفحص `candidateProfile.isAvailable` — العمود ده **اتشال من
  الأهلية بالكامل من ADR-0017** (نموذج Opt-out)، مش مستخدم في أي مكان تاني في المطابقة الحقيقية —
  يعني تجنيد الفريق كان شغال بقاعدة أهلية **مختلفة تمامًا وقديمة** عن باقي المنصة، بالظبط النوع من
  الانجراف (drift) اللي المالك حذّر منه صراحة في بند 21/24 من رسالته.
- `listRecruitCandidates()`/`recruitMember()` صفر وعي بـ`classifyTechnicianCapacity()` (LIGHT/
  MEANINGFUL/HEAVY/BLOCKED، ADR-0020) — فني مثقل (HEAVY) كان ممكن يتجنّد فورًا بصمت، عكس فلسفة
  "مفيش تحميل صامت" اللي ADR-0020 بنتها بالظبط لمسار المطابقة العادي.

## القرار

### 1. `computeCrewComposition()` تستبدل `computeCrewShortage()` بالكامل (مصدر وحيد)

دالة جديدة في `order-team.service.ts` (نفس مكان القديمة، 3 مستخدمين بس فاستبدال مباشر آمن):

```ts
interface CrewComposition {
  requiredTechnicians: number;   // افتراضي 1 لو null (طلب فردي عادي)
  requiredAssistants: number;    // افتراضي 0 لو null
  assignedTechnicians: number;   // بما فيهم القائد (+1 دايمًا)
  assignedAssistants: number;
  missingTechnicians: number;
  missingAssistants: number;
  crewComplete: boolean;
}
function computeCrewComposition(
  requiredTechnicians: number | null,
  requiredAssistants: number | null,
  counts: { technicians: number; assistants: number }, // من order_team_members.member_type
): CrewComposition
```

بتستخدم `member_type` الموجود بالفعل في `order_team_members` (migration `0076`) لتفرقة العدّ —
عمود موجود من زمان بس مش مُستخدم في حساب النقص قبل كده. هي **مصدر الحقيقة الوحيد** لسؤال "الطاقم
كامل؟" في كل مكان: `technician-order-execution.controller.ts`، `AdminOrdersService`، `OrderResponseDto`
(الآن معروضة في كل مسارات قراءة الطلب، مش بس `getOne`/`team-assigned` زي قبل)، أي endpoint أدمن
جديد يعرض حالة الطاقم.

### 2. أولوية الفريق الدائم + إعادة استخدام نموذج القدرة/الأهلية الحقيقي في التجنيد

`listRecruitCandidates()`/`recruitMember()` بيتصلحوا ليستخدموا **بالحرف** نفس الدوال المستخدمة في
المطابقة العادية — مفيش خوارزمية تانية:

- **أولوية**: الاستعلام بيرجّع صف إضافي `is_leader_team_member boolean` (فني عنده نفس
  `company_id` بتاع القائد) — الترتيب `ORDER BY is_leader_team_member DESC, distance_km ASC` بدل
  المسافة بس. أعضاء الفريق الدائم بيظهروا الأول دايمًا لو مؤهّلين، من غير ما نستبعد الباقي.
- **الأهلية/القدرة**: `isAvailable` بتتشال نهائيًا من `recruitMember()`. بدالها:
  `technicianAvailabilityCondition()` (نفس الشرط الموحّد، بتاريخ `order.scheduledAt` الحقيقي —
  مش "دلوقتي" زي قبل، لأن أغلب طلبات الفريق مجدولة قدام) لاستبعاد `BLOCKED`، و`classifyTechnicianCapacity()`
  لتحديد LIGHT (تجنيد فوري تلقائي، زي قبل) مقابل MEANINGFUL/HEAVY (**فرصة اختيارية** عبر
  `TechnicianWorkOpportunitiesService.offerIfNotExists()` بدل تجنيد صامت — بالظبط فلسفة ADR-0020).
- **الرتبة**: قاعدة `TECHNICIAN_LEVEL_RANK` الموجودة (§31) تتطبّق زي ما هي — مفيش هرمية تانية.

### 3. بوابة اكتمال الطاقم عند بداية التنفيذ الفعلي

`OrdersService.transitionAsTechnician()` بيكتسب فحص جديد (نفس نمط فحص `after_photo` الموجود لـ
`WORK_COMPLETED`): الانتقال لـ`IN_PROGRESS` (`start()`) لطلب `booking_mode=TEAM` بيترفض لو
`crewComplete === false`. القائد يقدر يوصل/يتحرك (`depart()`/`arrive()`) بطاقم ناقص (منطقي — ممكن
باقي الطاقم يوصل بعده)، بس **مايبدأش الشغل الفعلي** بطاقم ناقص. رسالة خطأ واضحة بالعربي (مش خطأ
تقني عام) تقول بالظبط الناقص إيه.

### 4. تفسير المطابقة (Admin explainability) — استهلاك نفس المنطق، صفر إعادة بناء

Endpoint أدمن جديد (`GET /admin/orders/:id/candidate-explanation/:technicianId`) بينادي **نفس**
`technicianAvailabilityCondition()`/`classifyTechnicianCapacity()`/شروط الفئة والمنطقة المستخدمة في
`findEligibleTechnicians()` الحقيقية — بس بيرجّع تفصيل كل شرط (PASS/FAIL) بدل قرار واحد فقط. أي
تعديل مستقبلي في قاعدة الأهلية الحقيقية بينعكس تلقائيًا هنا (نفس الدالة المصدر)، صفر احتمال انجراف.

### 5. مركز العمليات (فئات/بروفايل 360/تنبيهات) — طبقة قراءة فوق الموجود، صفر مصدر حقيقة جديد

كل واجهات الأدمن الجديدة (عرض فئة، بروفايل فني 360، تنبيهات، توزيع) بتُبنى كـ**استعلامات قراءة**
تجمّع بيانات من الجداول/الدوال الموجودة فعلاً (`technician_profiles`, `technician_work_opportunities`,
`order_assignments`, `classifyTechnicianCapacity()`, إلخ) — صفر جدول تخزين حالة مشتقة جديد إلا لو
غير قابل للحساب في وقت الاستعلام بكفاءة (مثال وحيد: نشاط/اتصال الفني — بند 6 تحت).

### 6. "متصل الآن" — عمود مراقبة فقط، منفصل تمامًا عن الأهلية

عمود جديد `technician_profiles.last_active_at` (timestamptz nullable) — يتحدّث من أي طلب حقيقي من
تطبيق الفني (heartbeat خفيف + أي نداء API عادي أصلاً بيعدّي عبر middleware مشترك). **مفيش أي مكان
في `technicianAvailabilityCondition()`/`classifyTechnicianCapacity()`/المطابقة الحقيقية بيقرا
العمود ده أبدًا** — استخدامه الوحيد عرض "متصل الآن/آخر نشاط قبل س" في الأدمن، بالظبط زي طلب المالك
الصريح في بند 12/8 ("Online/offline is observability only").

## البدائل اللي اتقيّمت

- **جدول تخزين منفصل لـ"حالة الطاقم"** (بدل حساب `computeCrewComposition()` وقت الطلب) — اتُرفض:
  `order_team_members` بالفعل مصدر حقيقة كافي وسريع (فهرس على `order_id`)، وتخزين مشتق يعني مزامنة
  إضافية عرضة لانحراف — نفس الدرس من `quality_score` الميت (§24).
- **خوارزمية تشخيص منفصلة في `apps/admin` للتفسير** (أسرع تنفيذ) — اتُرفضت صراحة: المالك حذّر منها
  بالحرف في بند 13 ("do not implement a fake frontend diagnostic algorithm") — نفس فئة البَقّة اللي
  خلقت انجراف قديم في مشاريع تانية.
- **عمود `is_online` boolean بدل `last_active_at` timestamp** — اتُرفض: timestamp بيدّي "آخر نشاط
  قبل س" (مفيد تشغيليًا) بدل ثنائية خام، وأرخص (تحديث نادر، مفيش حاجة realtime إجبارية).

## الأثر

- Migration جديدة لـ`technician_profiles.last_active_at` + أي جدول مساعد لتنبيهات الأدمن (لو
  احتاج threshold تخزين — راجع تفاصيل التنفيذ في `docs/08` §35).
- `OrderTeamService`/`AdminOrdersService`/`technician-order-execution.controller.ts`/
  `OrderResponseDto` — تعديل مباشر، صفر endpoints قديمة تتشال (نفس فلسفة §29.2/§30.3 — الإضافة فوق
  الموجود، القديم يفضل شغال لحد ما يتأكد إنه بلا مستخدم).
- `apps/admin` — صفحات جديدة (فئة، بروفايل فني 360، تنبيهات) + تعديل صفحة تفاصيل الطلب لعرض
  `crew_status` الموحّد.
- `apps/technician-app` — شاشة تفاصيل الطلب للقائد تعرض `crew_status` (فني/مساعد منفصلين) بدل
  `team_shortage`/`team_members_needed` القديمة (تستبدل، مش تتكرر).
- تفاصيل التنفيذ الكاملة (endpoints، مراحل، اختبارات) في `docs/08-pricing-engine-and-platform-vision.md`
  §35.
