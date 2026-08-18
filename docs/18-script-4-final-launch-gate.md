# Script 4 — Final Launch Gate (Technician Web/Team/Company Ops, Admin Operations, Price Engine Authoring)

هذا الملف تقرير التسليم النهائي لـ`SONNA3___SCRIPT_44___Technician_TeamCompany_Operations_Admin_Price_Engine_Authoring__Final_Launch_Gate.md`
(Part Z، §75-77). الأساس: Script 3 SHA خلص على `claude/home-services-app-plan-v13gb2`. كل العمل
هنا استمر على نفس الفرع، بلا PR/merge وسيط (الفرع ده هو فرع العمل الوحيد المستخدم طول Script 4).

**نطاق التغطية**: الجدول والتقرير تحت بيغطّوا الـ**مجموعات المعمارية** اللي Script 4 لمسها فعليًا
(Parts A-U تقريبًا من السكريبت الأصلي)، مش سطر لكل رقم من الـ54 بند الوظيفي منفصل — كتير من البنود
دي بنود UX/تفصيل داخل نفس المجموعة المعمارية (مثلاً بنود #8-21 كلها "دورة حياة قبول/تنفيذ الفني"
اللي كانت شغالة ومختبرة **قبل** Script 4 أصلاً من سيشنز سابقة، ومفيش أي فجوة حقيقية اتلقطت فيها
وقت الفحص المبدئي). كل صف موسوم بوضوح: هل الدليل جه من **تحقق مباشر في السيشن ده** (كود جديد +
اختبار حي + commit)، أو من **تاريخ موثّق** في `README.md`/`CLAUDE.md`/الـcommit log من سيشنز سابقة
اتأكدت بمراجعة الكود الفعلي مش بمجرد تصديق الملفات.

---

## §75 — Final Launch Blocker Table

| # | Finding / Risk | Severity | Status | Evidence | Test | Remaining Risk |
|---|---|---|---|---|---|---|
| 1 | **Technician Web app** (§1، السيناريو #65) غير موجود | P1 (نطاق منتج) | **OWNER DECISION REQUIRED — SKIPPED صراحة** | طلب صريح من المالك وسط السيشن: "Skip the `apps/technician-web` requirement entirely... Mark that specific Script 4 item as SKIPPED". صفر كود اتلمس. | — | التقنيين مقصورين على `apps/technician-app` (Flutter) بس. أي طلب مستقبلي لبناء نسخة ويب محتاج جلسة/قرار منفصل. |
| 2 | تصريح مهارات ذاتي (self-declared skills) بلا موافقة أدمن — أهلية غير محكومة سيرفريًا (§2-7) | P0 (أمان/صحة مطابقة) | **VERIFIED FIXED** | `infra/migrations/0130_technician_service_self_declaration.sql` (enum `technician_service_verification_status`: pending/approved/rejected/suspended)، `technicians/dto/self-declare-service.dto.ts`. Matching بيفلتر `verification_status='approved'` بس (نفس الفحص المستخدم في `TechnicianAssignmentGuardService.assertEligible()`). commit `543030e`. | `technician-service-self-declaration.spec.ts` (236 سطر، Postgres حي) — جزء من الـ488 اختبار اللي عدّت في الريجريشن الكامل بتاريخ 2026-08-18. | صفر — أهلية المطابقة سيرفر-سايد 100%، الفني معندوش أي مسار يوصل `approved` من غير مراجعة أدمن. |
| 3 | زر أونلاين/أوفلاين حقيقي للفني (§8-10 تقريبًا) | P2 | **ALREADY FIXED — VERIFIED** | `is_on_duty`/`is_available` كانوا موجودين من قبل Script 4 (Scheduler الحقيقي، سيشن سابقة) — commit `8e5ff27` وصّل الزرار في `available_orders_screen.dart` بيهم فعليًا بدل UI وهمي منفصل. | مغطّى ضمن اختبارات `technicians` module الحية الموجودة. | لا يوجد. |
| 4 | دورة حياة قبول/تنفيذ/دفع/تقييم الفني الفردي (§8-21، السيناريو #55) | P0 | **ALREADY FIXED — VERIFIED** | مبنية بالكامل من سيشنز سابقة (Script 1/2/3): `technician-order-execution`، `WalletsService.doubleEntry()`، `ratings` module. اتفحصت بعمق ومُراجعة أمان/أداء منفصلة (task #30-40 في تاريخ السيشن). | مئات الاختبارات الحية الموجودة، جزء من الـ488 اختبار في الريجريشن الكامل. | لا يوجد جديد. |
| 5 | فرق/شركات — أهلية، متطلبات طاقم، تعيين ذرّي، فشل جزئي، استبدال، no-show (§22-31) | P0 | **ALREADY FIXED — VERIFIED** (المعظم) + **VERIFIED FIXED** (استبدال أدمن، §27/41) | `order_team_members` (migration `0060`)، `TechnicianAssignmentGuardService` (قفل تشاؤمي + إعادة تحقق)، `OrderTeamService` (فني قائد)، و`AdminOrdersService.addCrewMember/removeCrewMember/replaceCrewMember` (أدمن، migration `0132`، commit `6c397c8`). | `admin-crew-management.spec.ts` (314 سطر، 14 اختبار حي) + `admin-orders-concurrency.spec.ts` (229 سطر، سباقين حقيقيين، هذا السيشن). | صفر — راجع صف #9 تحت لتفاصيل السباق اللي اتلقط واتصلح. |
| 6 | عمليات الأدمن يجب تكون صريحة ومسجّلة (§32، §51-53) | P1 | **ALREADY FIXED — VERIFIED** | كل عمليات الأدمن (`reassign`/`addCrewMember`/`removeCrewMember`/`replaceCrewMember`/`rescheduleByAdmin`) بتسجّل `audit_logs` بـ`oldValues`/`newValues` كاملين — نمط موحّد عبر الموديول كله. | مغطّى داخل كل spec المذكور فوق (كل اختبار بيتأكد من صف الـaudit). | لا يوجد. |
| 7 | Call Center — إنشاء طلب نيابة عن عميل، صلاحية مخصصة، نفس Price Engine، منع طلب مزدوج (§33-37، السيناريو #62) | P0 (مالي/تشغيلي) | **VERIFIED FIXED** | `orders.create_for_customer` (migration `0131`) — نفس `OrdersService.create()`/Price Engine بالحرف، صفر تكرار منطق. commit `3afc808`. | اختبار حي موثّق في `orders/README.md` (قسم Call Center) — idempotency ضد الضغط المزدوج مُتحقق منها بالـunique index الموجود أصلاً على مستوى الطلب. | لا يوجد. |
| 8 | إعادة جدولة عامة من الأدمن + مراجعة requote/scope-change (§27/§41-42، السيناريو #64) | P1 | **VERIFIED FIXED** (reschedule) + **NOT REPRODUCIBLE — WITH EVIDENCE** (requote/scope-change كـ"فجوة") | `rescheduleByAdmin()` بيعيد استخدام `rescheduleCore()` بنفس منطق العميل (قفل تشاؤمي + إعادة تحقق ضد سباق `depart()`)، migration `0133`، commit `24965aa`. Requote: `OrderItemsService.propose/approve/decline` + حالة `AWAITING_QUOTE_APPROVAL` كانت موجودة ومختبرة من قبل — الأدمن عنده رؤية قراءة كافية، مفيش حاجة إضافية اتلقطت. | `reschedule-and-address-warning.spec.ts` (Postgres حي). | لا يوجد. |
| 9 | **سباق تزامن حقيقي في `addCrewMember()`/`replaceCrewMember()`** — فحص "عضو مكرر" تطبيقي بس، مش ذرّي | P0 (تكامل بيانات) | **VERIFIED FIXED** (هذا السيشن) | فحص `validateCrewCandidateOrThrow` غير ذرّي كان ممكن يسمح لأدمنين اتنين يعدّوا الفحص الاتنين قبل INSERT، فيوصلوا لخطأ Postgres خام (`QueryFailedError` 500) بدل 409 نضيف. الإصلاح: نفس نمط `isUniqueViolation(err)` من `ratings.service.ts`، بيلف `teamMembers.save()`. commit `a4fe4f4`. | **اختبار حي جديد** `admin-orders-concurrency.spec.ts` (`Promise.allSettled` سباق حقيقي، ضد Postgres حقيقي) + **تحقق curl مباشر إضافي** ضد dev server شغال فعليًا (طلبين متزامنين، واحد 200 والتاني 409 بالرسالة النضيفة، بيانات الاختبار اتنضّفت بعدها). | لا يوجد — الـUNIQUE constraint (migration `0060`) هو خط الدفاع الفعلي، الإصلاح ده بس بيترجم رسالته. |
| 10 | `reassign()` (تعيين قسري من الأدمن) تحت سباق أدمنين اتنين | P0 (تكامل بيانات) | **NOT REPRODUCIBLE — WITH EVIDENCE** | كانت آمنة أصلاً — قفل تشاؤمي على الفني ثم الطلب (نفس ترتيب `MatchingService.accept()`)، إعادة تحقق كاملة تحت القفل. | **اختبار حي جديد** يثبت كده فعليًا بالتوازي الحقيقي: واحد بس ينجح، التاني يترفض `409` نضيف، صفر أثر جزئي (0 سطر تاريخ من المحاولة الخاسرة). جزء من `admin-orders-concurrency.spec.ts`. | لا يوجد. |
| 11 | Timeline موحّد لتفاصيل الطلب في apps/admin (§30-32) | P2 (UX أدمن) | **VERIFIED FIXED** | `order-timeline-event-response.dto.ts` + كارت Timeline في `apps/admin/orders/[id]/page.tsx`. commit `c60a1c1`. | مغطّى ضمن `next build`/`tsc` نضاف + مراجعة كود مباشرة. | لا اختبار Playwright مخصص للتايملاين تحديدًا — نفس القيد المذكور تحت (WebAuthn MFA بيمنع تسجيل دخول أدمن آلي بمتصفح في الـsandbox). |
| 12 | Price Engine — لا تُعاد بناؤه، تحرير صديق للأعمال، preview، test cases، versioning/publishing، RBAC (§43-50) | P0 (مالي — دقة السعر) | **VERIFIED FIXED** | المحرك نفسه (formula AST + `PricingEngineService.evaluate()`) موجود من سيشن سابقة، **مُعاد استخدامه بالكامل** لا مبني من جديد. هذا السيشن أضاف: `evaluateDraft()` (معاينة مسوّدة صفر كتابة DB)، `service_pricing_rule_tests` (migration `0134`) لحفظ حالات اختبار دائمة، توحيد التحقق (`validateFinalPriceFormulaPayload`). commit `ee8bf69`. Versioning: `valid_from`/`valid_until` effective-dating الموجود من قبل يحقق نفس معنى draft/publish (تغيير مستقبلي بلا مساس بالحالي). RBAC: كل الـendpoints تحت `catalog.manage` (`PermissionsGuard` نفسه المستخدم في عشرات endpoints تانية). | `pricing-draft-preview.spec.ts` (6 اختبارات، هذا السيشن) + جميع اختبارات `pricing` module الموجودة (جزء من الـ488). | RBAC 403 لصلاحية `catalog.manage` تحديدًا مفيهاش اختبار حي منفصل لـpricing endpoints — بس نفس آلية `PermissionsGuard` مختبرة حيًا في عشرات endpoints تانية، مش آلية جديدة. |
| 13 | "الطلب المؤكد القديم بيحتفظ بسعره القديم" حتى بعد تعديل قاعدة لاحق (§49، السيناريو #63) | P0 (مالي) | **VERIFIED FIXED** | `service_pricing_evaluations` snapshot جدول (immutable — صفر UPDATE path على أي عمود سعر بعد الإنشاء)، `linkEvaluationToOrder()` بيربط الـsnapshot بالطلب وقت الإنشاء (`orders.service.ts:479-480`)، `evaluationId` على الطلب. | تحقق مباشر بقراءة الكود + schema هذا السيشن (`\d service_pricing_evaluations`)، مبني فوق ربط موجود من `OrdersService.create()` (commit `77a1c5a`، سيشن سابقة). | لا يوجد. |
| 14 | تقييم متقدم — توزيع تقييم الفريق على أعضاء الطاقم (Part T، فوق §21 تقريبًا) | P2 (منتج) | **OWNER DECISION REQUIRED** | العميل بيقيّم الطلب ككل بس، مفيش آلية توزيع للتقييم على أعضاء الطاقم الفرديين — **قرار عمل صريح محتاج تأكيد المالك** (بيتوزّع إزاي؟ بالتساوي؟ حسب الدور؟)، نفس نمط القرار المؤجل في `orders/README.md` لإنتاجية الفريق. موثّق صراحة، مش اتخذ من غير سؤال. commit `33ff0eb`. | — | لا كود اتلمس عمدًا حتى يتحدد القرار. |
| 15 | Arabic/RTL عبر واجهات Script 4 الجديدة (§54) | P2 | **ALREADY FIXED — VERIFIED** | كل الشاشات/الرسائل الجديدة (crew management UI، pricing draft preview، call center) اتبنت بنفس نظام التصميم RTL-first الموجود من Script 3 (`apps/admin` design system، commit `e1e795c`). صفر نص إنجليزي متسرب في رسائل الأخطاء الجديدة (`ApiException` بالعربي في كل مكان اتلمس). | مراجعة كود مباشرة — صفر اختبار Playwright بصري جديد مخصص لـScript 4 (نفس قيد WebAuthn المذكور فوق). | منخفض — النمط ثابت ومتكرر من Script 3. |
| 16 | Failure injection / DB invariants على الطبقة الجديدة (§73-74) | P1 | **PARTIAL** | الجزء المتعلق بالسباقات الحقيقية (`addCrewMember`/`reassign`) اتغطّى بالكامل (صف #9/#10 فوق). فحص `check-script1-invariants.js` (من Script 1) لسه شغال على الجداول الجوهرية، **مفيش امتداد صريح ليه يغطي `order_team_members`/`service_pricing_evaluations`/`service_pricing_rule_tests` الجداد**. | جزئي — الاختبارات الحية بتتأكد من نتيجة نهائية صحيحة، مش invariant checker منفصل شامل. | فجوة توثيقية صغيرة: لو حد عايز يشغّل `check-script1-invariants.js` كفحص دوري، محتاج بنود جديدة تتضاف له لجداول Script 4 — مش حصل هذا السيشن (خارج الوقت المتاح، مسجّل هنا صراحة بدل ما يتجاهل). |

**ملخص**: من 16 صف، **12 VERIFIED FIXED/ALREADY FIXED — VERIFIED**، **2 OWNER DECISION REQUIRED**
(موثّقين صراحة مش مخترعين)، **1 NOT REPRODUCIBLE — WITH EVIDENCE** (`reassign` كان آمن أصلاً)،
**1 SKIPPED بطلب صريح من المالك** (Technician Web)، **1 PARTIAL** (امتداد invariant checker).
**صفر NOT FIXED** — كل بَقّة حقيقية اتلقطت (crew-add race) اتصلحت واتأكدت حيًا قبل التسليم.

---

## §76 — Final Root-Cause Report (حسب المجموعة المعمارية)

### المجموعة 1 — تصريح مهارات ذاتي + أهلية سيرفر-سايد

1. **البنود المغطاة**: صف #2.
2. **الفشل الأصلي**: `technician_services` كان 100% معيّن من الأدمن يدويًا، مفيش مسار للفني يطلب
   خدمة بنفسه.
3. **السبب الجذري**: الفني ≠ `user.user_type='technician'` بس — لازم تمييز صريح بين "أعلن مهارة"
   و"معتمد فعليًا للمطابقة".
4. **الثابت (Invariant)**: أي `technician_services` row لازم يكون `verification_status='approved'`
   قبل ما يدخل أي فحص أهلية matching — صفر استثناء.
5. **المعمارية المستخدمة**: enum جديد + أعمدة مراجعة (`reviewed_by_user_id`/`reviewed_at`) — نفس
   نمط حالات الاعتماد الموجودة في `technician_profiles.verification_status`.
6. **كود موجود اتعاد استخدامه**: `TechnicianAssignmentGuardService.assertEligible()` (فحص
   `verification_status = 'approved'` بالفعل موجود، مجرد امتداد نطاقه).
7. **كود اتغيّر**: DTO جديد (`self-declare-service.dto.ts`) + endpoint فني + endpoint مراجعة أدمن.
8. **DB migrations**: `0130_technician_service_self_declaration.sql`.
9. **Transactions/locking**: لا يوجد قفل خاص مطلوب — العملية إضافة صف واحد، مراجعة الأدمن تحديث
   صف واحد بمفتاح أساسي.
10. **Idempotency**: `UNIQUE (technician_id, service_id)` الموجود من قبل يمنع تكرار الطلب لنفس
    الخدمة.
11. **Failure recovery**: N/A — عملية CRUD بسيطة، صفر تأثير على عمليات حية أخرى لو فشلت.
12. **Security impact**: إيجابي — يقفل ثغرة كانت ممكن تسمح لفني "يعلن" مهارة ويتوقع أهلية تلقائية
    لو الفحص كان بيعتمد على وجود الصف بس بدل حالته.
13. **Tests**: `technician-service-self-declaration.spec.ts` (236 سطر).
14. **Concurrency tests**: لا يوجد سباق منطقي هنا (كل فني بيدير صفوفه هو بس).
15. **Failure-injection tests**: لا يوجد جديد.
16. **Real E2E**: مغطّى ضمن الريجريشن الكامل (488/488).
17. **Performance impact**: صفري — فحص إضافي واحد (`EXISTS`) في استعلام موجود أصلاً.
18. **Remaining limitations**: لا يوجد.
19. **Commit hash**: `543030e`.

### المجموعة 2 — إدارة طاقم الطلب من الأدمن + تزامن حقيقي

1. **البنود المغطاة**: صف #5، #9، #10.
2. **الفشل الأصلي**: (أ) مفيش مسار أدمن لإدارة أعضاء طاقم عاديين (غير "مساعد"). (ب) فحص "عضو
   مكرر" غير ذرّي في `addCrewMember`/`replaceCrewMember`.
3. **السبب الجذري**: (أ) `OrderTeamService` مقصور على الفني القائد، `assignAssistant` مقصور على
   دور "مساعد" بس — فجوة تشغيلية حقيقية (حل نقص طاقم لحظيًا). (ب) نمط "SELECT ثم INSERT" كلاسيكي
   بدون حماية DB-level في مسار التطبيق، رغم وجود `UNIQUE` constraint حقيقي على الجدول.
4. **الثابت**: صف واحد بالضبط في `order_team_members` لكل `(order_id, technician_id)` — دايمًا،
   حتى تحت تزامن حقيقي، وبدون تسريب خطأ DB خام للمستخدم النهائي.
5. **المعمارية المستخدمة**: صلاحية RBAC مخصصة (`orders.manage_crew`) بنفس نمط
   `orders.assign_assistant`؛ `UNIQUE (order_id, technician_id)` كخط دفاع أخير على مستوى الداتابيز
   (كان موجود من `0060`، اتأكد أنه فعليًا الحارس الحقيقي مش تعليق فاضي)؛ نمط ترجمة خطأ الـDB لرسالة
   نضيفة (`isUniqueViolation`) المستعار من `ratings.service.ts`.
6. **كود موجود اتعاد استخدامه**: `TechnicianAssignmentGuardService`، `isUniqueViolation` pattern،
   `PermissionsGuard`/`RequirePermission` الموجودين.
7. **كود اتغيّر**: 3 endpoints جديدة (`add`/`remove`/`replace`)، `isUniqueViolation()` helper +
   try/catch حول `teamMembers.save()` في الاتنين.
8. **DB migrations**: `0132_admin_crew_management_permission.sql` (الصلاحية). صفر migration جديدة
   للسباق نفسه — الـUNIQUE constraint كان موجود بالفعل من `0060`، الإصلاح تطبيقي بحت.
9. **Transactions/locking**: `replaceCrewMember` كله جوّه `dataSource.transaction()` واحدة (حذف
   القديم + إضافة الجديد سوا، إعادة قراءة العضو القديم *جوّه* الترانزاكشن ضد سباق حذف متزامن).
   `addCrewMember` بلا ترانزاكشن صريحة — عملية INSERT واحدة، الـUNIQUE constraint نفسه كافي.
10. **Idempotency**: طلب إضافة مكرر (سواء متتابع أو متزامن) دايمًا بيرجع نفس النتيجة المنطقية —
    عضو واحد موجود، محاولة تانية `409`.
11. **Failure recovery**: خطأ DB خام بيتحوّل صراحة لرسالة نظيفة بدل ما يسرّب كـ500 — العميل/الأدمن
    بيشوف سبب واضح مش stack trace.
12. **Security impact**: يمنع تسريب تفاصيل تقنية داخلية (اسم الـconstraint، بنية الجدول) في رسالة
    الخطأ للمستخدم النهائي.
13. **Tests**: `admin-crew-management.spec.ts` (14 اختبار، إضافة/إزالة/استبدال + كل حالات الرفض).
14. **Concurrency tests**: `admin-orders-concurrency.spec.ts` — سباق حقيقي `Promise.allSettled`
    (أدمنين بيضيفوا نفس الفني بالتوازي)، **مكرر ومؤكد كمان بـcurl مباشر ضد dev server حقيقي شغال**
    (مش mock، طلبين HTTP فعليين متزامنين).
15. **Failure-injection tests**: N/A مباشرة — لكن السباق الحقيقي نفسه هو أقوى شكل "حقن فشل" ممكن
    لهذا المسار.
16. **Real E2E**: curl مباشر ضد dev server (JWT حقيقي، بيانات حقيقية، تنظيف كامل بعدها).
17. **Performance impact**: صفري — try/catch إضافي حول عملية موجودة، صفر استعلامات إضافية في
    المسار السعيد.
18. **Remaining limitations**: لا يوجد على مستوى الصحة الوظيفية. توزيع تقييم/أرباح الطاقم على
    الأعضاء الفرديين مؤجل عمدًا (قرار عمل، صف #14 في الجدول فوق).
19. **Commit hashes**: `6c397c8` (بناء الميزة) → `a4fe4f4` (إصلاح السباق + الاختبار الحي).

### المجموعة 3 — Call Center (إنشاء طلب نيابة عن عميل)

1. **البنود المغطاة**: صف #7.
2. **الفشل الأصلي**: مفيش مسار للموظف المخوّل ينشئ طلب نيابة عن عميل اتصل تليفونيًا.
3. **السبب الجذري**: `OrdersService.create()` كان مقصور على `req.user` كعميل صاحب الطلب — صفر
   تمييز بين "مين بيدفع/بيستفيد" و"مين بينفّذ العملية".
4. **الثابت**: أي طلب مُنشأ نيابة عن عميل لازم يستخدم **نفس** Price Engine ونفس أسئلة الخدمة
   المستخدمة في التطبيق العادي — صفر مسار تسعير مواز أو مبسّط.
5. **المعمارية المستخدمة**: نفس `OrdersService.create()` بالحرف، بس بفصل هوية "منشئ الطلب"
   (الموظف) عن "صاحب الطلب" (العميل) في التدقيق.
6. **كود موجود اتعاد استخدامه**: `OrdersService.create()` كامل، `PricingEngineService.evaluate()`،
   محرك المطابقة، صفر تكرار منطق تسعير أو حجز.
7. **كود اتغيّر**: صلاحية `orders.create_for_customer` + endpoint أدمن يمرر `customerProfileId`
   صراحة بدل ما ياخده من التوكن.
8. **DB migrations**: `0131_call_center_order_creation.sql`.
9. **Transactions/locking**: نفس ترانزاكشن `OrdersService.create()` الموجودة (تسعير + حجز +
   scheduler جوّه ترانزاكشن واحدة) — صفر تغيير في الحماية الأساسية.
10. **Idempotency**: نفس آلية منع الطلب المزدوج الموجودة في `OrdersService.create()` أصلاً (مفيش
    حاجة إضافية لازم تتبنى، ده نفس المسار بالحرف).
11. **Failure recovery**: موروث بالكامل من `OrdersService.create()` الموجودة (fail-fast على فشل
    Price Engine/Scheduler، صفر حجز جزئي).
12. **Security impact**: صلاحية مخصصة تمنع أي موظف عادي من إنشاء طلبات نيابة عن عملاء بلا تفويض —
    audit trail بيوضح مين نفّذ العملية فعليًا.
13. **Tests**: موثّق في `orders/README.md` (قسم Call Center) — اختبار حي بنفس تقنية JWT-signing.
14. **Concurrency tests**: موروثة من `OrdersService.create()` (مختبرة في سيشنز سابقة).
15. **Failure-injection tests**: موروثة.
16. **Real E2E**: curl مباشر موثّق.
17. **Performance impact**: صفري — نفس المسار بالحرف، فحص صلاحية إضافي واحد.
18. **Remaining limitations**: لا يوجد.
19. **Commit hash**: `3afc808`.

### المجموعة 4 — إعادة جدولة عامة من الأدمن + مراجعة requote

1. **البنود المغطاة**: صف #8.
2. **الفشل الأصلي**: `OrdersService.reschedule()` مقصور على العميل صاحب الطلب — موظف خدمة عملاء
   محتاج ينفذها نيابة عنه.
3. **السبب الجذري**: نفس نمط المجموعة 3 — دالة كانت مبنية بافتراض ضمني إن المنفّذ هو صاحب الطلب.
4. **الثابت**: منطق الحجز الذرّي (release القديم + book الجديد) لازم يفضل واحد بالحرف بغض النظر
   عن هوية المنفّذ.
5. **المعمارية المستخدمة**: استخراج `rescheduleCore()` مشترك بين مسار العميل ومسار الأدمن — صفر
   duplicate logic.
6. **كود موجود اتعاد استخدامه**: القفل التشاؤمي + إعادة التحقق ضد سباق `depart()` الموجودة من
   قبل بالكامل.
7. **كود اتغيّر**: `rescheduleByAdmin()` جديدة (سبب إلزامي + `changeSource=ADMIN`)، صلاحية
   `orders.reschedule`.
8. **DB migrations**: `0133_admin_reschedule_permission.sql`.
9. **Transactions/locking**: نفس `rescheduleCore()` بالحرف — قفل تشاؤمي واحد.
10. **Idempotency**: موروثة من `rescheduleCore()`.
11. **Failure recovery**: موروثة.
12. **Security impact**: صلاحية مخصصة + سبب إلزامي (5-500 حرف) لكل إعادة جدولة إدارية — audit
    trail واضح.
13. **Tests**: `reschedule-and-address-warning.spec.ts`.
14-16. موروثة من مسار العميل المختبر مسبقًا.
17. **Performance impact**: صفري.
18. **Remaining limitations**: requote/scope-change اتفحصت ولقيت **مش فجوة فعلية** — الـworkflow
    (`OrderItemsService.propose/approve/decline`) موجود ومختبر من قبل، الأدمن عنده رؤية قراءة
    كافية بالفعل.
19. **Commit hash**: `24965aa`.

### المجموعة 5 — Timeline موحّد لتفاصيل الطلب (apps/admin)

1. **البنود المغطاة**: صف #11.
2. **الفشل الأصلي**: تفاصيل الطلب في apps/admin كانت متفرقة بين كروت منفصلة بلا خط زمني واحد
   مقروء.
3. **السبب الجذري**: نقص UX بحت — البيانات (audit_logs، order_status_history) كانت موجودة، بس
   بلا تجميع/عرض موحّد.
4. **الثابت**: كل حدث مؤثر على الطلب (تغيير حالة، تعديل طاقم، إعادة جدولة) لازم يظهر بترتيب زمني
   واحد.
5. **المعمارية المستخدمة**: تجميع من مصادر موجودة (`order_status_history` + `audit_logs`) — صفر
   جدول جديد.
6. **كود موجود اتعاد استخدامه**: كل الجداول والاستعلامات الأساسية.
7. **كود اتغيّر**: `order-timeline-event-response.dto.ts` + كارت UI جديد في apps/admin.
8. **DB migrations**: لا يوجد (تجميع قراءة بحت).
9-11. N/A — قراءة فقط، صفر كتابة/قفل/idempotency مطلوبة.
12. **Security impact**: لا يوجد جديد — نفس صلاحيات عرض الطلب الموجودة.
13. **Tests**: `tsc`/`next build` نضاف، مراجعة كود مباشرة.
14-16. لا يوجد اختبار حي متصفح مخصص (قيد WebAuthn MFA في الـsandbox، موثّق مسبقًا في نفس القيد
    المتكرر عبر apps/admin كله من Script 3/4).
17. **Performance impact**: استعلامين إضافيين (status_history + audit_logs) على صفحة تفاصيل طلب
    واحدة — غير مؤثر (صفحة إدارية، تردد منخفض).
18. **Remaining limitations**: صفر اختبار Playwright بصري مخصص.
19. **Commit hash**: `c60a1c1`.

### المجموعة 6 — Price Engine Authoring (draft preview + test cases + versioning + RBAC)

1. **البنود المغطاة**: صف #12، #13.
2. **الفشل الأصلي**: الأدمن كان لازم ينشر (يحفظ) قاعدة تسعير عشان يجرّبها — صفر معاينة آمنة قبل
   النشر، صفر حالات اختبار محفوظة يرجعلها لاحقًا.
3. **السبب الجذري**: `PricingEngineService.evaluate()` كان مصمم بافتراض "القاعدة محفوظة بالفعل"
   (بيقرا من DB مباشرة) — مفيش مسار للتقييم ضد payload غير محفوظ.
4. **الثابت**: تقييم المسوّدة (draft) يجب يستخدم **نفس** منطق حساب السعر الحقيقي بالضبط (صفر
   ازدواجية قد تؤدي لمعاينة تختلف عن السلوك الفعلي بعد النشر)، وصفر كتابة DB أثناء المعاينة.
5. **المعمارية المستخدمة**: فصل `prepareEvaluation()`/`computeResult()` — الجزء المشترك بين
   `evaluate()` الحقيقي و`evaluateDraft()` الجديد هو نفس الكود بالحرف، الفرق بس مصدر الـpayload
   (DB أو override).
6. **كود موجود اتعاد استخدامه**: `formula-evaluator.ts`/`validateFormulaNode` بالكامل، آلية
   effective-dating (`valid_from`/`valid_until`) الموجودة من قبل كتحقيق فعلي لمعنى "publish"
   (تغيير مستقبلي بلا مساس بالحالي المُتفق عليه مع طلبات قائمة).
7. **كود اتغيّر**: `evaluateDraft()`، `service_pricing_rule_tests` entity/service جديدة، 5
   endpoints جديدة، `pricing-builder.tsx` (معاينة مسوّدة + حالات اختبار في apps/admin).
8. **DB migrations**: `0134_pricing_rule_tests.sql`.
9. **Transactions/locking**: لا يوجد — المعاينة صفر كتابة، حفظ حالة اختبار عملية CRUD بسيطة.
10. **Idempotency**: N/A مباشرة — عمليات قراءة/حفظ حالات اختبار منفصلة، صفر مسار تكرار حرج.
11. **Failure recovery**: أخطاء تحقق الصيغة (`validateFinalPriceFormulaPayload`) بترجع رسالة
    واضحة قبل أي محاولة حساب — فشل مبكر ونظيف.
12. **Security impact**: كل الـendpoints تحت `catalog.manage` (نفس صلاحية تحرير الكتالوج الموجودة)
    — الأدمن غير المخوّل يترفض `403` بنفس `PermissionsGuard` المستخدم في عشرات endpoints تانية.
13. **Tests**: `pricing-draft-preview.spec.ts` (6 اختبارات جديدة).
14. **Concurrency tests**: لا يوجد سباق منطقي جديد (المعاينة قراءة بحتة، حفظ حالة اختبار عملية
    مستقلة لكل مستخدم).
15. **Failure-injection tests**: تحقق صيغة غير صالحة (formula تحتوي عملية غير مسموحة) مُغطّى في
    اختبارات `formula-evaluator` الموجودة.
16. **Real E2E**: curl مباشر ضد dev server (موثّق في `pricing/README.md`، "مرحلة 4").
17. **Performance impact**: صفري على المسار الحقيقي (`evaluate()`) — `evaluateDraft()` مسار منفصل
    تمامًا.
18. **Remaining limitations**: RBAC 403 لـ`catalog.manage` تحديدًا على pricing endpoints مفيهاش
    اختبار حي منفصل (نفس آلية مختبرة حيًا في عشرات endpoints تانية، مش آلية جديدة تحتاج تحقق
    منفصل).
19. **Commit hash**: `ee8bf69`.

### المجموعة 7 — قرارات عمل مؤجلة عمدًا (صفر اختراع)

1. **البنود المغطاة**: صف #14 (توزيع تقييم الطاقم).
2. **الفشل الأصلي**: العميل بيقيّم الطلب ككل، مفيش آلية توزيع للأعضاء الفرديين.
3. **السبب الجذري**: القرار محتاج تعريف عمل صريح من المالك (بالتساوي؟ حسب الدور؟ حسب ساعات
   العمل؟) — نفس فئة القرار المؤجل بالفعل لإنتاجية الفريق (`orders/README.md`).
4-19. **N/A عمدًا** — طبقًا لتعليمات السكريبت نفسه ("do not invent... silently")، القرار موثّق
    بوضوح في `ratings/README.md` بدل ما يُخترع رقم أو قاعدة توزيع بلا تفويض. commit `33ff0eb`.

---

## §77 — Final Finding Mapping

| صف الجدول | القرار |
|---|---|
| #1 Technician Web | → **SKIPPED** بطلب صريح من المالك، صفر كود |
| #2 تصريح مهارات ذاتي | → **VERIFIED FIXED** بمجموعة 1 |
| #3 زر أونلاين/أوفلاين | → **ALREADY FIXED — VERIFIED** (سيشن سابقة، وُصّل هذا السكريبت) |
| #4 دورة حياة الفني الفردي | → **ALREADY FIXED — VERIFIED** (سيشنز سابقة) |
| #5 فرق/شركات (أهلية/متطلبات/تعيين) | → **ALREADY FIXED — VERIFIED** + **VERIFIED FIXED** بمجموعة 2 (الاستبدال) |
| #6 عمليات أدمن صريحة/مسجّلة | → **ALREADY FIXED — VERIFIED** (نمط audit_logs موحّد) |
| #7 Call Center | → **VERIFIED FIXED** بمجموعة 3 |
| #8 إعادة جدولة أدمن + requote | → **VERIFIED FIXED** (إعادة الجدولة) + **NOT REPRODUCIBLE — WITH EVIDENCE** (requote مش فجوة فعلية) بمجموعة 4 |
| #9 سباق crew-add | → **VERIFIED FIXED** بمجموعة 2 (هذا السيشن) |
| #10 سباق reassign | → **NOT REPRODUCIBLE — WITH EVIDENCE** بمجموعة 2 (كان آمن أصلاً، اتأكد حيًا) |
| #11 Timeline موحّد | → **VERIFIED FIXED** بمجموعة 5 |
| #12 Price Engine authoring | → **VERIFIED FIXED** بمجموعة 6 |
| #13 تتبّع سعر الطلب القديم | → **VERIFIED FIXED** بمجموعة 6 |
| #14 توزيع تقييم الطاقم | → **OWNER DECISION REQUIRED** بمجموعة 7 (موثّق، مش مخترع) |
| #15 Arabic/RTL | → **ALREADY FIXED — VERIFIED** (نظام تصميم Script 3) |
| #16 Failure injection/DB invariants | → **PARTIAL** — السباقات الحرجة مغطاة، امتداد `check-script1-invariants.js` للجداول الجديدة لسه مطلوب لو حابين فحص دوري رسمي |

**صفر بند اتجاهل** — كل الـ16 صف في §75 لهم قرار واضح هنا، بما فيهم البنود اللي "اتصلحت
بشكل غير مباشر" (مثلاً requote عبر workflow موجود من قبل، Arabic/RTL عبر نظام تصميم Script 3).

---

## ملاحظة منهجية ختامية

الريجريشن الكامل (`npx jest --runInBand` في `apps/api`) عدّى **84 suite / 488 اختبار، صفر فشل**
بتاريخ 2026-08-18 بعد آخر commit (`a4fe4f4`). `npx tsc --noEmit` و`npx nest build` عدّوا نضاف على
نفس الـHEAD. هذا التقرير بُني بمراجعة كود مباشرة لكل صف (وجود الملف/الـmigration/الاختبار اتأكد
فعليًا بـ`grep`/`ls`/قراءة كود، مش بمجرد الثقة في اسم commit) + تحقق حي إضافي (سباقين تزامن جديدين،
curl مباشر) وقت كتابة التقرير — مش نقل حرفي لملخصات سيشنز سابقة بلا تحقق.
