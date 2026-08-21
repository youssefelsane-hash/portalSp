# ADR-0028: قدرة "نطاق أيام مرن" لكل خدمة (`allows_date_range_booking`)

**الحالة:** معتمد
**التاريخ:** 2026-08-21

## السياق

Phase A.2 من محرك الحجز الموحّد (docs/08 §42) — الشريحة اللي المالك سمّاها صراحة في خطة الترتيب
المرحلي: *"شكل الجدولة (`allows_date_range_booking`) + ربطها بـ`bulkSetAvailability` الموجودة
(تمديد حجم القايمة، مش محرك جديد)"*.

**تدقيق حي (Explore agent، أدلة ملف:سطر) قبل أي كود** أثبت:
1. "مرن — اختار نطاق أيام" (`scheduled_at_range_end`، docs/08 §32.3) موجودة ومختبرة حيًا بالفعل —
   مش ميزة جديدة. الحل كامل في `OrdersService.create()` (`orders.service.ts:282-310`): لو
   `dto.scheduled_at_range_end` موجودة، بيدوّر يوم بيوم (أقصى 14 يوم) على أقرب يوم فيه فني مؤهّل
   عبر `TechniciansService.hasEligibleTechnicianForDate()` الموجودة، ويثبّت الطلب عليه.
2. **صفر فحص قدرة على مستوى الخدمة حاليًا** — أي خدمة، بلا استثناء، بتقبل `scheduled_at_range_end`
   النهاردة. `apps/customer-app`'s `ScheduleSelectionScreen` بيعرض كارت "مرن" بلا أي شرط، وبيتصل
   بيه من `catalog_navigation.dart` من غير ما يمرر `service` للشاشة أصلاً.
3. **"ربطها بـ`bulkSetAvailability`" (نص الخطة) موجودة فعليًا بالفعل، مش محتاجة كود جديد** —
   `bulkSetAvailability()` بتكتب صفوف `blocked` في `technician_schedule_slots`، ونفس الصفوف دي
   بتتفحص فعلاً جوّه `technicianAvailabilityCondition()` (`technician-eligibility.sql.ts`) اللي
   `hasEligibleTechnicianForDate()` بتستخدمها. يعني "الربط" ده حصل من يوم ما `scheduled_at_range_end`
   اتبنت (docs/08 §32) — مفيش عمل إضافي هنا غير قراءة الكود بدقة.
4. `previewPrice()` **ما بيلمسش `scheduled_at_range_end` خالص** (`PreviewOrderDto` مالهاش حقل
   جدولة أصلاً — الجدولة مالهاش أي أثر على السعر، قرار موثّق في تعليق الملف). نفس نمط
   `cash_allowed`/`deposit_required` (الاتنين مش متفحوصين في `previewPrice()` كمان) — رجريشن صفري
   للحفاظ على الاتساق.

## القرار

1. **`services.allows_date_range_booking` (`boolean NOT NULL DEFAULT true`, migration 0165)** —
   نفس نمط `cash_allowed`/`deposit_required` بالحرف: علم مباشر على `Service`. **الافتراضي `true`
   متعمّد بالكامل** (مختلف عن `deposit_required` اللي افتراضيها `false`) — لأن الخيار ده متاح فعليًا
   لكل خدمة النهاردة بلا أي فحص، فالعلم ده تحويل الوضع الحالي لقدرة صريحة، مش قيد جديد. صفر تغيير
   سلوك لأي خدمة موجودة.
2. **الفحص في `OrdersService.create()` نفسها** — جوّه الـ`if (dto.scheduled_at_range_end)` الموجود
   بالفعل (`orders.service.ts:288`)، قبل فحص `!dto.scheduled_at`: لو الخدمة `allows_date_range_booking=false`
   والعميل بعت `scheduled_at_range_end`، الطلب يترفض `VAL_001` وقت الإنشاء — مش بعد ما الحلقة
   تدوّر على أيام مالهاش معنى للخدمة دي. **صفر لمس لمنطق حل النطاق نفسه** (الحلقة، `hasEligibleTechnicianForDate`)
   — القدرة دي بوابة دخول بس، مش تعديل على الخوارزمية.
3. **`previewPrice()` صفر تغيير** — نفس السبب فوق (بند 4 في السياق)، متسقة مع `cashAllowed`/
   `depositRequired`.
4. **`apps/customer-app` — إخفاء كارت "مرن" مش مجرد رفض من السيرفر**: تجربة استخدام أفضل من رسالة
   خطأ بعد ما العميل يختار نطاق تاريخ ويرجع يكتشف إن الخدمة مش بتدعمه. `ScheduleSelectionScreen`
   بقت بتاخد `allowsDateRangeBooking` (bool) بدل ما تكون stateless بالكامل، و`catalog_navigation.dart`
   بيمررها من `service.allowsDateRangeBooking` (حقل جديد على `CatalogService` model، نفس نمط
   `allowsIndividual`/`allowsTeam` الموجودين).
5. **الأدمن يتحكم فيها من نفس فورم "تفاصيل الخدمة" الموجود** — checkbox جديد جنب `cash_allowed`/
   `deposit_required`، مش شاشة منفصلة.

## البدائل اللي اتقيّمت

- **الافتراضي `false` (زي `deposit_required`) بدل `true`** — رُفض. `deposit_required` افتراضيها
  `false` لأنها قدرة *جديدة* (مفيش خدمة بتطلب إيداع النهاردة). "نطاق مرن" مختلف جوهريًا: كل خدمة
  بتقبله فعليًا دلوقتي بلا فحص — افتراض `false` كان هيبقى قيد رجعي (regression) على كل خدمة موجودة،
  عكس مبدأ "صفر تغيير سلوك" المتّبع في A.1/A.3.
- **بناء "محرك جدولة" جديد يربط القدرة دي بـ`technician_schedule_slots` مباشرة** — رُفض بشدة، وده
  بالظبط الخطأ اللي القاعدة الحاكمة (docs/08 §42: "صفر محرك سعة تاني") بتحذّر منه. التدقيق أثبت
  الربط موجود بالفعل (بند 3 في السياق) — أي "بناء" هنا كان هيبقى تكرار لمنطق شغال.
- **الاكتفاء بفحص السيرفر بلا تعديل `apps/customer-app`** — رُفض. الفحص السيرفري وحده كافي أمنيًا/
  منطقيًا، بس بيسيب تجربة استخدام سيئة (العميل يختار نطاق، يرجع يكتشف إنه مرفوض) لخدمة القدرة دي
  متفعّلة عليها الأدمن فعليًا — نفس فلسفة إخفاء خيار "اعتماد" لو `allowsTeam=false` بدل رفضه بعد
  الاختيار.

## الأثر

- Migration جديدة: `services.allows_date_range_booking` (افتراضي `true`) — صفر كسر لأي خدمة موجودة.
- `OrdersService.create()`: فحص جديد جوّه فرع `scheduled_at_range_end` الموجود — يترفض `VAL_001`
  لو النطاق المرن على خدمة `allows_date_range_booking=false`.
- `AdminCatalogService`/`CreateServiceDto`/`UpdateServiceDto`: حقل جديد اختياري.
- `apps/admin`: checkbox جديد في فورم تفاصيل الخدمة.
- `packages/shared-types`: تمديد `AdminServiceResponseDto`/`CreateServiceBody`.
- `apps/customer-app`: `CatalogService` model حقل جديد + `ScheduleSelectionScreen`/`catalog_navigation.dart`
  بيخفوا كارت "مرن" لو الخدمة مش بتدعمه.
- اختبار حي جديد: نطاق مرن على خدمة `allows_date_range_booking=false` يترفض، نفس الخدمة بيوم محدد
  (`scheduled_at` بلا `scheduled_at_range_end`) تتسجّل عادي، وخدمة عادية (`allows_date_range_booking=true`
  الافتراضي) تفضل تقبل النطاق المرن زي ما كانت بالظبط (رجريشن صفري).
