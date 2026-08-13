# assistant-matching — مطابقة المساعد التلقائية (ADR-0007)

قرار عمل صريح من المالك (2026-08-13)، حلّ فجوة كانت موثّقة صراحة من زمان في `docs/08` §6:
"auto-matching تلقائي لمساعدين متاحين — مؤجل لأن مفهوم 'مساعد متاح للربط' مش موجود في القاموس،
مش هيتخترع." التصميم الكامل والبدائل اللي اتقيّمت في `docs/adr/0007-assistant-pool-matching.md` —
اقرأه الأول قبل أي تعديل هنا، الملف ده ملخّص تنفيذي بس.

## الفكرة في سطرين

لو الطلب محتاج مساعد (`orders.required_assistants > 0`، من `ServiceStandardData`/محرك الإنتاجية،
راجع `../orders/README.md`)، بعد ما الفني القائد يقبل الطلب: **أولوية 1** المساعد الشخصي
المعتمد بتاعه لو متاح، **أولوية 2** بث تنافسي لمجمع المساعدين المؤهلين — أول قبول صحيح ياخد
الشريحة، ذرّي بالكامل (مفيش سباق).

## نقطة الانطلاق

`OrderAcceptedAssistantMatchingListener` بيسمع `ORDER_ACCEPTED_EVENT` (نفس الحدث اللي
`MatchingService.accept()` بيصدّره لحظة قبول الفني القائد — أول لحظة نعرف فيها القائد أصلاً).
`AssistantMatchingService.startMatching()`:

1. لو `order.requiredAssistants` هو `null`/`0` → **مفيش أي حاجة بتحصل خالص**، return فوري.
2. **أولوية 1**: فحص `TechnicianProfile.assistantLinkStatus===approved` + `assistantTechnicianId`
   للقائد. لو المساعد أهل (معتمد، متاح، `is_on_duty`، مفيش طلب نشط عليه بأي دور) → إدراج مباشر
   في `order_team_members` (`member_type='assistant'`, `role_label='مساعد'`) — **بلا بث خالص**.
3. **أولوية 2**: لو لسه فيه شرائح فاضية، بث لمجمع المساعدين المؤهلين (نفس معايير أهلية الفني
   العادي — `technician_services`+`technician_zones` لنفس خدمة/منطقة الطلب، مرتبين بالمسافة
   PostGIS، محدودين بـ`assistant_matching.batch_size`). كل مرشّح ياخد صف `order_assistant_offers`
   (`offer_status='sent'`) + إشعار (`notify()` عبر `NotificationsModule`، مش نداء مباشر — راجع
   "لماذا الإشعارات عبر أحداث" تحت). Job طابور (`assistant-matching` queue) بيتجدول بعد
   `assistant_matching.response_timeout_seconds` (افتراضي 120 ثانية).

## القبول الذرّي — أول قبول صحيح ياخدها

`AssistantMatchingService.accept(userId, offerId)`:
- قفل `pessimistic_write` على صف `orders` نفسه (**مش** صف العرض) — المورد المشترك الفعلي هو
  "عدد الشرائح المتاحة على الطلب"، مش أي عرض فردي. نفس نمط `MatchingService.accept()` بالحرف.
- **فحص حالة العرض بيتأجّل لحد بعد القفل عمداً** — لو حصل سباق بين اتنين على نفس العرض بالظبط
  (ضغطتين متزامنتين)، أو اتنين على عروض مختلفة لنفس الطلب، القفل بيسلسلهم كلهم صح. أول واحد
  يوصل يعدّي، الباقي بيتأكد إن حالة العرض اتغيّرت *بعد* ما ياخد القفل مش قبله.
- لو الشرائح اكتملت بالفعل (`filled >= requiredAssistants`) → العرض يتحول `slot_filled` صراحة
  ورفض `409` واضح ("حد تاني كسب السباق").
- لو ده آخر شريحة مطلوبة → **إغلاق فوري لكل العروض المعلّقة التانية** (`sent → slot_filled` دفعة
  واحدة) + إلغاء job الـ timeout المجدول (`queue.remove()`) — مفيش داعي نستنى المهلة لو الشغل خلص.

## التصعيد عند انتهاء المهلة

`AssistantOfferExpiryProcessor` (BullMQ، نفس نمط `MatchingRoundExpiryProcessor` بالحرف) —
بيعلّم العروض المعلّقة `expired`، ولو لسه فيه شرائح فاضية بيصدّر `ASSISTANT_MATCHING_ESCALATED_EVENT`.
مستمع منفصل (`AssistantMatchingEscalatedRoutingListener`، جوّه `NotificationsModule`) بيستخدم
`NotificationRoutingService.routeToRole('assistant_matching.escalated', ...)` — نفس آلية
`EmergencyOrderRoutingListener` بالحرف، بيوجّه لدور `ops_manager` (قاعدة توجيه مزروعة في
migration `0075`). الحل اليدوي الإداري بعد التصعيد اتقفل لاحقًا (ADR-0008، راجع "نطاق مؤجَّل
صراحة" تحت).

## لماذا الإشعارات عبر أحداث، مش نداء مباشر لـ`NotificationsService`

اتفحص الكود قبل التنفيذ: **مفيش أي موديول تاني في المشروع بيحقن `NotificationsService` مباشرة** —
كل الإشعارات بتتبعت من مستمعين (`listeners/`) عايشين جوّه `NotificationsModule` نفسها، مُفعّلين
بأحداث (`@OnEvent`). اتّبعنا نفس الاتفاقية بالحرف بدل ما نكسرها: `AssistantMatchingService`
بيصدّر 3 أحداث جديدة (`common/events/assistant-personal-assigned.event.ts`,
`assistant-opportunity-offered.event.ts`, `assistant-matching-escalated.event.ts`)، و3
مستمعين جداد اتضافوا لـ`NotificationsModule` (`assistant-personal-assigned-notification.listener.ts`,
`assistant-opportunity-notification.listener.ts`, `assistant-matching-escalated-routing.listener.ts`)
— الموديول ده نفسه ماعندوش أي اعتماد على `NotificationsModule` مباشرة، مفيش import دائري.

## اتأكد حي بالكامل (بناء 2026-08-13)

- **أولوية 1**: فني قائد حقيقي (مساعد شخصي معتمد ومتاح) قبل طلب `required_assistants=1` →
  `order_team_members` صف واحد فوري (`member_type='assistant'`)، **صفر** `order_assistant_offers`
  (مفيش بث لما أولوية 1 كفت). إشعار `assistant_assigned` وصل فعليًا.
- **أولوية 2**: نفس القائد بس مساعده الشخصي مش متاح (`is_available=false`) → صفر team_members
  فورًا، بث حقيقي لفنيين مؤهلين اتنين (نفس خدمة/منطقة الطلب، مسجّلين حديثًا عبر `/auth/register`
  حقيقي + موافقة أدمن + تعيين خدمة/منطقة، مش SQL خام).
- **سباق قبول متزامن حقيقي**: طلبين `POST /technician/assistant-offers/:id/accept` بالتوازي
  الفعلي (خلفيتين متزامنتين، مش تسلسليتين) من مساعدين مختلفين على نفس الطلب — **واحد بس نجح
  (201)**، التاني اترفض `409` واضح. `order_team_members` بعد السباق فيه صف واحد بالظبط (الفايز)،
  `order_assistant_offers` الفايز `accepted` والخاسر `slot_filled`. Job الـ timeout اتلغى فعليًا
  (اتأكد بفحص `redis-cli --scan` مباشر — صفر مفاتيح متأخرة متبقية).
- **`required_assistants=0`/`null`**: طلب بلا `standard_data_id` → قبول الفني القائد بلا أي أثر
  خالص — صفر `order_team_members`، صفر `order_assistant_offers`.
- **التصعيد عند انتهاء المهلة**: `assistant_matching.response_timeout_seconds` اتقلّل مؤقتًا لـ5
  ثواني عبر `PATCH /admin/settings/...` (مش SQL خام، عشان الـcache في Redis يتفرّغ صح)، طلب بلا
  أي مرشّح مؤهل متاح خالص (كل المساعدين اتعملهم `is_available=false` مؤقتًا) → بعد 5 ثواني بالظبط
  إشعار `assistant_matching_escalated` وصل فعليًا لدور `ops_manager` برسالة دقيقة ("لسه 1 مساعد
  ناقص"). كل الإعدادات اتترجعت لقيمتها الأصلية (120 ثانية) بعد التأكيد.
- بيانات الاختبار (فنيين جداد، عملاء، عناوين، طلبات) اتعملها تنضيف/إلغاء بعد كل اختبار — طلب
  الاختبار الأول كشف كمان **بيانات اختبار عالقة من سيشن سابقة** (طلب `accepted` من غير تنظيف كان
  حابس الفني القائد كـ"مشغول")، اتصلحت مباشرة (تحويله لـ`cancelled_by_system`).

**بَقّة كانت موثّقة هنا واتصلحت (2026-08-13، اتصلحت باستقلالية في سيشنين متوازيتين بنفس الحل
بالظبط)**: استعلامات استبعاد "الفني عنده طلب نشط بالفعل" (هنا في
`isCandidateEligible()`/`broadcastToPool()` وفي `matching.service.ts`'s `findEligibleTechnicians`)
كانت بتفحص `order_status` بس، **من غير فلترة `deleted_at IS NULL`** — لو صف طلب اتعمله soft-delete
(نادر، مش مسار عادي) لكن `order_status` فضل على قيمة نشطة (`accepted` مثلاً بدل حالة إلغاء صريحة)،
الفني كان بيفضل "محبوس" كمشغول للأبد رغم إن الطلب نفسه مش ظاهر لحد — نفس فئة البَقّة الموثّقة في
`../technicians/README.md`/`../customers/README.md`/`../buildings/README.md`. **الإصلاح**:
`AND deleted_at IS NULL` (أو `AND o.deleted_at IS NULL` لاستعلامات الـjoin على
`order_team_members`) اتضافت على الأربع استعلامات هنا (`isCandidateEligible`'s subqueries الاتنين
بـ`$2`، و`broadcastToPool`'s subqueries الاتنين بـ`$5`) وعلى استعلام `matching.service.ts` المطابق
(الـ5 استعلامات كلهم). اختبار regression حي ضد Postgres حقيقي في `../matching/matching.service.spec.ts`
بيثبت السلوك (طلب soft-deleted مبيستبعدش الفني تاني، وطلب حقيقي لسه بيستبعده زي الأول).

## نطاق مؤجَّل صراحة عن هذا البناء

- ~~حل يدوي إداري بعد التصعيد~~ — **اتقفلت (ADR-0008، 2026-08-13)**: `POST /admin/orders/:id/assistants`
  جديد في `AdminOrdersController` (موديول `orders`، مش الموديول ده — راجع ADR-0008 كامل). الأدمن
  بيختار فني من `/technicians` مباشرة (مفيش قايمة "مساعدين متاحين" منفصلة)، `order_team_members`
  اتضافلها `added_by_admin_user_id` بديل لـ`added_by_technician_id` (migration `0076`) عشان
  audit trail يفضل صادق (الأدمن مش فني). واجهة جديدة في `/admin/orders/:id` — كارت "المساعدين"
  بيظهر بس لو الطلب محتاج مساعدين، مع فورم التعيين.
- إعادة بث تلقائي عند كل رفض قبل انتهاء المهلة (زي `matching.service.ts`'s `reject()`) — قرار
  مقصود لتبسيط النطاق الأول، موثّق في ADR-0007 نفسه.
- فحص تعارض جدولة صريح (`technician_schedule_slots`) للمساعد — بالاكتفاء بفحص "مفيش طلب نشط"،
  نفس مستوى الدقة المستخدم للفني القائد في `matching.service.ts` أصلًا.
- `apps/customer-app`: لا حاجة — العميل مايشوفش تفاصيل مطابقة المساعد خالص (قرار العمل بالكامل
  داخلي بين الفني القائد/المساعد/النظام، العميل بس بيشوف نتيجة الفريق النهائي لو محتاج، عبر
  `orders.required_assistants` الموجود من قبل في `../orders/README.md`).
