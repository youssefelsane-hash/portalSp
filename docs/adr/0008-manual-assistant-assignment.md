# ADR-0008: تعيين مساعد يدوي من الأدمن بعد التصعيد

**الحالة:** معتمد
**التاريخ:** 2026-08-13

## السياق

ADR-0007 (مطابقة المساعدين التلقائية) أجّل صراحة في §7: "الحل اليدوي بعد كده (الأدمن يعيّن مساعد بنفسه) مؤجَّل صراحة عن نطاق الـADR ده — مفيش endpoint إداري 'عيّن مساعد يدوي' في المشروع أصلاً دلوقتي." المالك طلب إقفال كل الفجوات المتبقية (مراجعة شاملة 2026-08-13) — البند ده منها بالاسم.

السيناريو: `AssistantOfferExpiryProcessor` يعلّم العروض المعلّقة `expired` ويبعت `ASSISTANT_MATCHING_ESCALATED_EVENT` لو لسه فيه شرائح فاضية بعد انتهاء مهلة البث (120 ثانية افتراضيًا) — الحدث ده بيوصل لدور `ops_manager` عبر `NotificationRoutingService` بس **من غير أي فعل ممكن الأدمن ياخده من الواجهة** غير التواصل اليدوي مع فني برة النظام.

## القرار

### 1. عمود جديد بدل قيمة وهمية

`order_team_members.added_by_technician_id` كانت `NOT NULL` بافتراض "قائد الطلب هو المضيف دايمًا" (صحيح لحالتين: الإضافة اليدوية في "اعتماد"، والمطابقة التلقائية باسم القائد). التعيين اليدوي من الأدمن مالوش "فني مضيف" حقيقي — الحل المرفوض: حط `order.technicianId` (القائد) كقيمة `added_by_technician_id` وهمية، لأن ده بيكذب في الـaudit trail (يوهم إن القائد هو اللي أضاف، مش الأدمن). القرار: migration `0076` بتخلي العمود `NULL`-able وتضيف `added_by_admin_user_id UUID NULL REFERENCES users(id)` بديل، مع `CHECK` إن واحد منهم بس لازم يكون موجود (`chk_order_team_members_added_by`).

### 2. Endpoint إداري جديد

`POST /admin/orders/:id/assistants` (`AdminOrdersController`، موديول `admin` — مش `orders` نفسه، نفس فلسفة فصل كل أفعال الأدمن في موديول مستقل زي `adjust-price`/`refund` الموجودين بالفعل):
- Body: `{ technician_id: string }` — الأدمن بيختار من نفس شاشة تفاصيل الفني/بحث موجود بالفعل في `/technicians`، مفيش قايمة "مساعدين متاحين" منفصلة جديدة (تكرار لمنطق `findEligibleTechnicians` مش مبرر لفعل نادر الحدوث).
- فحوصات: الطلب موجود، `order.requiredAssistants` أكبر من عدد `order_team_members(member_type='assistant')` الحاليين (نفس فحص `AssistantMatchingService.accept()` — "الأماكن اكتملت")، الفني المطلوب `verification_status='approved'` (نفس فحص الأهلية الأساسي، بلا فحص "متاح دلوقتي" — الأدمن بيتخذ قرار واعي بتجاوز التوفر التلقائي في حالة تصعيد، ده الفرق الجوهري بين المسار اليدوي والتلقائي).
- عند النجاح: إدراج `order_team_members` (`member_type='assistant'`, `role_label='مساعد'`, `added_by_admin_user_id=adminUserId`, `added_by_technician_id=NULL`)، `audit_log` (`action='order.assistant_assigned_manually'`)، إشعار للفني المعيَّن (`notify()`, نفس نمط `ASSISTANT_PERSONAL_ASSIGNED_EVENT`).
- **مفيش قفل `pessimistic_write`** زي `AssistantMatchingService.accept()` — الأدمن فعل يدوي نادر (مش تنافس بث بين فنيين)، سباق حقيقي بين أدمنين اتنين نادر جدًا عمليًا ومقبول تجاريًا لو حصل (مش مسار مالي حرج زي قبول طلب).

### 3. واجهة الأدمن

قسم جديد في `apps/admin/src/app/orders/[id]/page.tsx` — بيظهر بس لو `order.required_assistants > 0` و`order.assigned_assistants_count < order.required_assistants` (حقلين جدد في `AdminOrderResponseDto`، محسوبين من نفس استعلام `order_team_members` الموجود). فورم بسيط: حقل بحث برقم موبايل/اسم الفني (نفس نمط البحث في `/technicians`)، زرار "عيّن كمساعد".

## البدائل اللي اتقيّمت

- **قيمة وهمية في `added_by_technician_id` (قائد الطلب) بدل عمود جديد**: رُفض — audit trail غير صادق، وبيكسر أي استعلام مستقبلي يفترض "الفني اللي في العمود ده هو اللي فعلاً ضغط الزرار".
- **إعادة استخدام `AssistantMatchingService.accept()` بمرور `adminOverride=true`**: رُفض — الدالة دي مبنية حول قفل صف الطلب وفحص عرض (`OrderAssistantOffer`) مش موجود أصلاً في المسار اليدوي (الأدمن مش بيقبل عرض، بيعيّن مباشرة)، تطويعها كان هيعقّد المسارين التلقائي واليدوي في دالة واحدة بلا فايدة حقيقية.
- **قايمة "مساعدين متاحين" مخصصة في شاشة التعيين**: رُفض للنسخة الأولى — نفس منطق أهلية `findEligibleTechnicians` مكرر لفعل تصعيد نادر؛ الأدمن أصلاً بيقدر يبحث عن أي فني من `/technicians` الموجودة.

## الأثر

- Migration `0076`: `order_team_members.added_by_technician_id` بقت nullable + عمود `added_by_admin_user_id` جديد + `CHECK` constraint.
- `OrderTeamMember` entity، `AdminOrdersService`/`AdminOrdersController` (endpoint جديد)، `AdminOrderResponseDto` (حقلين جدد).
- `apps/admin`: قسم جديد في صفحة تفاصيل الطلب.
- **خارج النطاق عمدًا (زي ADR-0007)**: إعادة بث تلقائي، فحص تعارض جدولة صريح للتعيين اليدوي (الأدمن مسؤول عن القرار ده بنفسه، مش النظام).
