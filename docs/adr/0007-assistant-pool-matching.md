# ADR-0007: مطابقة المساعدين التلقائية (Assistant Pool Matching)

**الحالة:** معتمد
**التاريخ:** 2026-08-13

## السياق

`docs/08` §6 كانت موثّقة صراحة كفجوة مؤجلة: "auto-matching تلقائي لمساعدين متاحين — مؤجل لأن مفهوم 'مساعد متاح للربط' مش موجود في القاموس، مش هيتخترع." المالك حدد القرار بالتفصيل الكامل (قرار عمل صريح، 2026-08-13):

- **أولوية 1**: لو الطلب محتاج مساعد (`orders.required_assistants > 0`، من `ServiceStandardData`/محرك الإنتاجية — موجود من قبل، راجع `orders/README.md`)، وللفني القائد مساعد شخصي معتمد (`TechnicianProfile.assistantLinkStatus=approved`)، ومتاح، وملوش تعارض حجز → يتاخد هو أولاً.
- **أولوية 2**: لو مفيش مساعد شخصي متاح، تتفتح الفرصة لمجمع المساعدين المؤهلين عبر الإشعارات، **أول قبول صحيح ياخدها** (concurrency-safe/atomic — فايز واحد بس لو اتنين قبلوا في نفس اللحظة)، وبمجرد اكتمال العدد المطلوب الفرصة تتقفل فورًا.
- لو معدية مهلة محددة بدون قبول كافي → تصعيد لمساعدين إضافيين لو محتاج، ولو المهلة خلصت والمجمع كله ماردش → تصعيد للعمليات/الأدمن.
- `required_assistants=0` → مفيش أي مطابقة تتبدأ خالص.

المفهوم نفسه ("مساعد متاح للربط، مطابقة تلقائية، قبول تنافسي") **جديد بالكامل في الـschema** — مفيش أي جدول/آلية موجودة تغطيه. هو subsystem جديد فعليًا (مش وصلة زي إنتاجية الفريق/مضاعف مستوى الفني اللي اتقفلوا في نفس الجلسة)، فمحتاج ADR قبل التنفيذ حسب قاعدة CLAUDE.md.

## القرار

### 1. موديول جديد: `apps/api/src/modules/assistant-matching/`

منفصل عن `matching` (اللي بيوزّع الطلب على الفني القائد) عمدًا — نفس مبرر فصل `domestic-workers` عن `technicians` (ADR-0004): مفهوم مختلف (قبول تنافسي على "شريحة عمل" مش "طلب كامل")، دورة حياة مختلفة (بيبدأ بعد قبول الفني القائد مش عند إنشاء الطلب)، ومفيش داعي نلمس `matching.service.ts` المستقرة والمُختبرة جيدًا.

### 2. Migration جديدة — جدولين + عمود

- **`order_assistant_offers`** (جديد بالكامل — عرض/بث فردي لكل مرشّح مساعد، بنفس فلسفة `order_assignments` بس لمجال مختلف):
  - `id UUID PK`, `order_id UUID FK orders`, `assistant_technician_id UUID FK technician_profiles`,
  - `offer_status VARCHAR` (`sent`|`accepted`|`rejected`|`expired`|`slot_filled`) — `slot_filled` حالة مميّزة عن `expired`: بتعني "الفرصة اتقفلت لأن حد تاني كسب السباق"، مش "محدش رد".
  - `sent_at TIMESTAMPTZ`, `expires_at TIMESTAMPTZ`, `responded_at TIMESTAMPTZ NULL`, `created_at`/`updated_at`.
  - Index على `(order_id, offer_status)` و`(assistant_technician_id, offer_status)` (نفس نمط `order_assignments`).
- **`order_team_members.member_type`** عمود جديد (`VARCHAR(20) NOT NULL DEFAULT 'team_member'`, `CHECK IN ('team_member','assistant')`) — **إعادة استخدام جدول `order_team_members` الموجود** (migration `0060`، docs/08 §5) لتخزين التعيين **النهائي** المؤكَّد لأي مساعد (شخصي أو من المجمع)، بدل ما نخترع جدول "تعيينات نهائية" منفصل. العمود الجديد ضروري عشان نفرّق استعلاميًا بين "عضو فريق اعتماد يدوي" و"مساعد اتوصل بالمطابقة التلقائية" — الاعتماد على `role_label` (نص حر) هش وغير موثوق للاستعلام.
  - **ملحوظة تصميم مهمة**: `AssistantMatchingService` **بيكتب في `order_team_members` مباشرة عبر الـ repository**، مش عن طريق `OrderTeamService.addMember()` الموجودة — الدالة دي مقصورة على `booking_mode=team` وعلى أعضاء من **نفس شركة القائد** (قيدين مقصودين لسياق "اعتماد" اليدوي، مش منطبقين على مساعد فردي/`booking_mode=individual`). إعادة استخدام الجدول مش الدالة.

### 3. نقطة الانطلاق: `ORDER_ACCEPTED_EVENT`

مستمع جديد `AssistantMatchingListener` (نفس نمط `OrderAcceptedNotificationListener`) بيسمع `ORDER_ACCEPTED_EVENT` (بيتصدّر من `MatchingService.accept()` لحظة ما الفني القائد يقبل الطلب — أول لحظة ممكن نعرف فيها مين القائد أصلاً). لو `order.requiredAssistants` هو `null` أو `0` → **مفيش أي حاجة بتحصل** (return فوري، مطابق لطلب المالك بالحرف). غير كده → `AssistantMatchingService.startMatching(orderId)`.

### 4. أولوية 1 — المساعد الشخصي

فحص مباشر على `TechnicianProfile` القائد: `assistantLinkStatus===APPROVED` و`assistantTechnicianId` موجود. أهلية المساعد الشخصي (نفس معايير "متاح، معتمد، مفيش تعارض" المستخدمة في `matching.service.ts`'s `findEligibleTechnicians`، بلا اختراع معايير جديدة):
- `verification_status='approved'`, `deleted_at IS NULL`.
- `is_available=true AND is_on_duty=true`.
- مفيش طلب نشط عليه كقائد (`ACTIVE_TECHNICIAN_ORDER_STATUSES`، نفس القائمة الموجودة).
- مفيش صف `order_team_members(member_type='assistant')` نشط ليه على طلب تاني لسه شغال (نفس فلسفة الاستبعاد، مطبّقة على دور المساعد).

لو الشروط اتحققت → إدراج مباشر في `order_team_members` (`member_type='assistant'`, `role_label='مساعد'`, `technician_id=assistant.id`, `added_by_technician_id=leadTechnician.id` — القائد هو "المسؤول" عن الإضافة دي حتى لو النظام نفّذها تلقائيًا، لأنه هو صاحب العلاقة الأصلية). إشعار للمساعد إنه اتعيّن (`notify()`، نفس نمط `order_assigned`). لو العدد المطلوب اكتمل بالكامل من أولوية 1 → **مفيش بث خالص**. لو لسه ناقص شرائح (مثلاً `required_assistants=2` والقائد عنده مساعد شخصي واحد بس) → أولوية 2 بتتفتح للباقي فقط.

### 5. أولوية 2 — بث لمجمع المساعدين

**تعريف "المجمع المؤهّل"**: **إعادة استخدام نفس معايير أهلية الفني العادي** (`technician_services`+`technician_zones` لنفس خدمة/منطقة الطلب، `verification_status='approved'`, متاح، مفيش تعارض) — مفيش مفهوم "نوع فني = مساعد" منفصل في الـschema، وده متعمّد: أي فني مؤهّل لنفس الخدمة/المنطقة صالح يشتغل كمساعد على طلب تاني (نفس المنطق اللي بيخلي فني يطلب فني تاني كمساعده شخصي بكوده بس، بلا قيد نوع). استبعاد الفني القائد نفسه ومساعده الشخصي (لو اتفحص وترفض في أولوية 1) من القايمة.

- ترتيب بالمسافة (PostGIS `ST_Distance` من عنوان الطلب، نفس استعلام `findEligibleTechnicians`) ومحدود بإعداد `assistant_matching.batch_size` (افتراضي 10 — نفس فلسفة `matching.batch_size`).
- إدراج صف `order_assistant_offers` لكل مرشّح (`offer_status='sent'`, `expires_at=now+assistant_matching.response_timeout_seconds` — إعداد جديد، افتراضي **120 ثانية** (أطول من مهلة الفني القائد 30 ثانية عمدًا — قرار مقصود قابل للتعديل: المساعد مش بيتخذ قرار حرج زي قبول الطلب الأساسي، فمهلة أرخى منطقية، مش خطأ نسخ).
- إشعار `notify()` لكل مرشّح (`notification_type='assistant_opportunity'`, deep link لشاشة قبول/رفض جديدة في `apps/technician-app`).
- Job طابور جديد (`assistant-matching` queue، نفس نمط `matching-rounds` بالحرف) بيتنفّذ بعد المهلة — لو لسه فيه شرائح فاضية، يعلّم العروض المعلّقة `expired` ويصعّد.

### 6. القبول الذرّي — أول قبول صحيح ياخدها

`POST /technician/assistant-offers/:offerId/accept` — جوّه transaction واحدة:
- **قفل `pessimistic_write` على صف `orders` نفسه** (مش صف العرض) — نفس القفل اللي `MatchingService.accept()`/`dispatchNextRound()` بيستخدموه على نفس الطلب، عشان أي محاولتين قبول متزامنتين لنفس الطلب (سواء لمساعدين مختلفين أو حتى نفس المساعد بغلط) يتسلسلوا حقيقي على مستوى الداتابيز، مش على مستوى تطبيق بس.
- عدّ `order_team_members` الحالية بـ`member_type='assistant'` لنفس الطلب. لو `count >= order.requiredAssistants` → **رفض واضح 409** ("الأماكن المطلوبة اكتملت بالفعل") + تعليم العرض ده `slot_filled` (مش `rejected` — تمييز واضح بين "رفضت أنا" و"اتقفلت قبل ما أوصل").
- غير كده → قبول: `offer_status='accepted'`, إدراج `order_team_members` جديد. لو بعد الإدراج ده `count+1 >= requiredAssistants` → **إغلاق فوري**: كل العروض المعلّقة التانية (`sent`) لنفس الطلب تتحول `slot_filled` دفعة واحدة، وإلغاء job الـ timeout المجدول (`removeJob`، نفس نمط أي إلغاء طابور تاني بالمشروع).
- `POST /technician/assistant-offers/:offerId/reject` — بسيط، `offer_status='rejected'`. **مفيش إعادة بث فورية** لو الكل رفض قبل المهلة (بخلاف `matching.service.ts`'s `reject()`) — قرار مقصود لتبسيط النطاق الأول: المهلة (120 ثانية) قريبة بما فيه الكفاية إن التأخير مش مؤثر عمليًا، وتفادي تعقيد "جولات" متعددة لسيناريو مش مطلوب صراحة من المالك (بيقول "لو محدش قبل خلال المهلة → تصعيد"، مش "جولة تانية").

### 7. التصعيد عند انتهاء المهلة

الـ processor (`AssistantOfferExpiryProcessor`) بعد ما يعلّم العروض المعلّقة `expired`: لو لسه فيه شرائح فاضية (`count < requiredAssistants`) → `NotificationRoutingService.routeToRole('assistant_matching.escalated', {...})` — **نفس آلية `EmergencyOrderRoutingListener` بالحرف** (`routeToRole`، مش نظام موازي)، رسالة توضّح رقم الطلب وعدد الشرائح الناقصة. الحل اليدوي بعد كده (الأدمن يعيّن مساعد بنفسه) **مؤجَّل صراحة عن نطاق الـADR ده** — مفيش endpoint إداري "عيّن مساعد يدوي" في المشروع أصلاً دلوقتي (`OrderTeamService.addMember()` الموجودة مقصورة على الفني القائد نفسه)، وبناء واحد جديد مش مطلوب صراحة في specification المالك (طلب "تصعيد + إشعار" بس، مش "شاشة تعيين يدوي جديدة"). موثّق كنطاق متبقي صريح، مش سهو.

### 8. الإعدادات الجديدة (`settings`, `group_name='assistant_matching'`)

- `assistant_matching.pool_matching_enabled` (boolean, افتراضي `true`) — مفتاح إيقاف عام، نفس فلسفة `technician_cancellation.self_cancel_enabled`.
- `assistant_matching.batch_size` (number, افتراضي `10`).
- `assistant_matching.response_timeout_seconds` (number, افتراضي `120`).

## البدائل اللي اتقيّمت

- **جدول "تعيينات نهائية" منفصل بدل إعادة استخدام `order_team_members`**: رُفض — نفس مبرر كل قرارات "إعادة الاستخدام" في المشروع، التعيين النهائي لمساعد مفهومياً "عضو فريق بدور مساعد"، مش كيان مختلف جوهريًا. عمود `member_type` كفاية للتفرقة الاستعلامية.
- **استخدام `OrderTeamService.addMember()` الموجودة بدل كتابة مباشرة**: رُفض — قيودها (`booking_mode=team` بس، نفس الشركة بس) مصمَّمة لسياق "اعتماد" اليدوي المختلف تمامًا، تطبيقها هنا كان هيعني إما تغيير قيودها (يكسر §5 المُختبرة) أو التفافها بشروط استثناء هشة.
- **إعادة بث فورية عند كل رفض (زي `matching.service.ts`)**: رُفض للنسخة الأولى — تعقيد "جولات" مش مطلوب صراحة، والمهلة الأطول (120 ثانية) تغطي نفس الهدف عمليًا. ممكن يتضاف لاحقًا لو المالك طلب صراحة.
- **قفل على صف `order_assistant_offers` بدل صف `orders`**: رُفض — القفل لازم يكون على المورد المشترك الفعلي (عدد الشرائح المتاحة على الطلب)، مش على صف العرض الفردي (اللي مفيهوش أي تنافس حقيقي بين طلبين مختلفين على نفس المورد).
- **معيار أهلية "نوع فني = مساعد" منفصل**: رُفض — مش موجود في القاموس المعتمد، والمالك مايطلبش تصنيف جديد؛ "مساعد" في المشروع ده مفهوم علاقة (linked) مش نوع حساب.

## الأثر

- Migration جديدة: `order_assistant_offers` (جدول كامل) + `order_team_members.member_type` (عمود إضافي) + 3 صفوف `settings`.
- موديول جديد `apps/api/src/modules/assistant-matching/` (service, controller, listener, processor, queue, entities, DTOs, README) — يستورد `TechniciansModule`/`OrdersModule`(Order فقط عبر TypeOrmModule.forFeature، نفس تحذير `matching.module.ts`)/`SettingsModule`/`NotificationsModule`(`NotificationRoutingService`)/`GeoModule`(المسافة)/`BullModule`.
- `apps/technician-app`: شاشة/قسم جديد لعرض فرص المساعدة المفتوحة + قبول/رفض (تصميم مشابه لشاشة "الطلبات المتاحة" الموجودة).
- **نطاق مؤجَّل صراحة عن هذا الـADR (مش سهو)**: حل يدوي إداري بعد التصعيد (إضافة endpoint جديد لو المالك طلبه لاحقًا)، إعادة بث تلقائي عند رفض قبل انتهاء المهلة، فحص تعارض جدولة (`technician_schedule_slots`) الصريح للمساعد (بالاكتفاء بفحص "مفيش طلب نشط" بدل فحص السلوتات — نفس مستوى الدقة المستخدم لفحص الفني القائد في `findEligibleTechnicians` أصلاً، مش تراجع في الدقة).
