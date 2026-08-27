# ADR-0044 — معاينة-ثم-سعر كوضع حجز على مستوى الطلب

- **الحالة**: مقبول
- **التاريخ**: 2026-08-27
- **السياق المرجعي**: `docs/08` §73 بند 1 (طلب مالك صريح)

## المشكلة

بعض الخدمات سعرها مش معروف مقدمًا — الفني لازم يعاين المكان الأول عشان يقدر يحدد سعر حقيقي.
`Service.pricingModel = 'inspection_then_quote'` **موجود من زمان كـenum value** (من أول تصميم
الكتالوج)، بس **ميت تمامًا** — `CatalogService.estimate()` مفيهوش أي فرع ليه، فبيقع في نفس مسار
`fixed`: السعر الأساسي الكامل بيتحصّل وقت الحجز، و`inspection_fee_cents` بيتضاف **فوقه** كرسم
إضافي، مش بدل منه. يعني العميل بيدفع سعر تقديري كامل مش حقيقي قبل ما أي حد يشوف المكان أصلاً.

المالك رفض صراحة الحل البديل الحالي (استخدام مسار "الشغل الإضافي" — `order_items`/
`AWAITING_QUOTE_APPROVAL`، docs/08 §21) لوضع السعر الأساسي فيه، لأنه "مش professional": المسار
ده مصمم عمدًا لإضافة على سعر **موجود بالفعل** بعد `IN_PROGRESS` (تشخيص+قطع غيار أثناء شغل شغال) —
استخدامه لتأسيس أول سعر لطلب لسه معندوش سعر أصلاً بيقلب معناه.

## القرار

وضع حجز جديد على مستوى الطلب نفسه، مبني فوق نفس الـPricing Engine وOrder State Machine
الموجودين — مش موديول موازي (بعكس `projects`، ADR-0036، اللي رفض صراحة استخدام `orders` كوحدة
تنفيذ لأسباب مختلفة: عروض أسعار بيكتبها الأدمن مش الفني في الموقع، ومعاينة "هنتواصل معاك" بشرية
بحتة صفر endpoint).

### 1. الحجز — رسم المعاينة بس

`CatalogService.estimate()` بقى فيه فرع صريح لـ`pricing_model=inspection_then_quote`:
`base_price_cents=0`, `estimated_total_cents=0`, `inspection_fee_cents` زي أي خدمة تانية.
`OrdersService.createOrder()` **صفر تعديل** — الصيغة الموجودة بالفعل
(`totalAmountCents = estimated_total_cents + inspection_fee_cents + surge + addons`) بترجع
`inspection_fee_cents` بس تلقائيًا. `commissionableBaseCents` بيتحسب زي أي طلب تاني
(`computeCommissionableBase`) — `workPriceCents=0` وقتها، فالوعاء = مكوّنات رسم المعاينة بس حسب
السياسة الحالية.

### 2. التنفيذ لحد المعاينة — صفر تغيير

الفني يقبل/يتحرك/يوصل بالضبط زي أي طلب عادي (`ACCEPTED → TECHNICIAN_ON_WAY → TECHNICIAN_ARRIVED`).

### 3. حالة جديدة: `awaiting_initial_quote_approval`

بعد `TECHNICIAN_ARRIVED`، الفني بينادي `POST /technician/orders/:id/submit-initial-quote`
(`InspectionQuoteService.submitInitialQuote()`) — بيحدد السعر بعد المعاينة، الطلب بينتقل لحالة
جديدة **مختلفة عن** `AWAITING_QUOTE_APPROVAL` الموجودة. السبب: الدلالة مختلفة جوهريًا — الموجودة
بتضيف على سعر مؤسَّس بالفعل (`propose()`'s hard gate `IN_PROGRESS`)، الجديدة بتؤسس أول سعر
لطلب لسه بلا سعر. تعميم الموجودة كان هيحتاج فروع شرطية تفرّق "إضافة" عن "تأسيس" جوّه نفس الدالة —
حالة منفصلة أوضح وأأمن (صفر خطر خلط الدلالتين بغلطة مستقبلية).

`order-state-machine.ts`:
```
TECHNICIAN_ARRIVED → [..., AWAITING_INITIAL_QUOTE_APPROVAL]
AWAITING_INITIAL_QUOTE_APPROVAL → [IN_PROGRESS, CANCELLED_BY_CUSTOMER]
```
مضافة لـ`CUSTOMER_CANCELLABLE_STATUSES`/`ACTIVE_TECHNICIAN_ORDER_STATUSES`/
`ENGAGED_TECHNICIAN_ORDER_STATUSES`/`TECHNICIAN_CONTACT_VISIBLE_STATUSES` — نفس معاملة
`AWAITING_QUOTE_APPROVAL` في الأربعة بالحرف (الفني لسه مرتبط بالطلب، لسه منشغل، العميل عنده رقمه).

### 4. الموافقة — نفس نمط `OrderItemsService.approve()` بالضبط

`POST /orders/:id/approve-initial-quote`:
- `order.estimatedPriceCents` (اتحط وقت `submitInitialQuote()`) بيتضاف لـ`totalAmountCents`
  (كان = `inspection_fee_cents` بس).
- `order.commissionableBaseCents += quotedAmountCents` **من غير شرط سياسة** (بعكس
  `includeAdditionalItems` المستخدم في إضافة الشغل الإضافي) — السعر ده هو **وعاء الشغل الأساسي
  نفسه** (`workPriceCents` في `computeCommissionableBase`)، مش بند إضافي فوقه؛ `workPriceCents`
  دايمًا داخل في الوعاء بلا شرط بتعريفه.
- الطلب يرجع `IN_PROGRESS` — نفس دورة أي طلب عادي بعد كده بالحرف.
- لو `paymentStatus=PAID` (رسم المعاينة اتحصّل إلكترونيًا) وطريقة الدفع إلكترونية، محاولة تحصيل
  فورية للدلتا عبر `PaymentsService.attemptAdditionalWorkCharge()` **الموجودة بالفعل** — إعادة
  استخدام كاملة، `batchId` هنا مجرد مفتاح idempotency (مش بيتفحص ضد `order_items`).

**الرفض**: مفيش endpoint منفصل — العميل يستخدم `POST /orders/:id/cancel` العادي (الحالة مضافة
لـ`CUSTOMER_CANCELLABLE_STATUSES`). رسم المعاينة اتحصّل بالفعل (زيارة حقيقية حصلت)، فمفيش رسوم
إلغاء إضافية فوقه — عادل لطرفين، ونفس فلسفة `AWAITING_QUOTE_APPROVAL`'s الإلغاء الكامل بالحرف.

## البدائل اللي اتقيّمت

| البديل | ليه اترفض |
|---|---|
| تعميم `order_items`/`AWAITING_QUOTE_APPROVAL` الموجودة | اعتراض المالك الصريح — الدلالة مختلفة جوهريًا (تأسيس مش إضافة)، وتعميمها كان هيحتاج فروع شرطية داخل دالة واحدة تفرّق الحالتين، بديل أضعف من حالة state machine منفصلة واضحة |
| استخدام موديول `projects` (ADR-0036) | مصمم لعروض أسعار **يكتبها الأدمن** لمشاريع كبيرة (تشطيب/ترميم)، مش لفني بيعاين في الموقع لخدمة كتالوج عادية. ADR-0036 رفض `orders` كوحدة تنفيذ لأسباب خاصة بيه (مرحلة مالية/تعاقدية) — مش نفس النطاق |
| جدول جديد لتخزين السعر المقترح (زي `order_items`) | `orders.estimated_price_cents` موجود بالفعل ومعناه بالظبط "سعر الخدمة الأساسي" — إعادة استخدامه بدل جدول جديد، نفس فلسفة "Do NOT overbuild" المتكررة في docs/08 §19/§21/§22 |
| تعديل `computeCommissionableBase()` نفسه | الدالة نقية ومختبرة، صفر داعي — الإضافة كلها في **بناء المدخلات** (`workPriceCents` مساويها `estimatedPriceCents` زي أي طلب عادي) |

## الأثر

- Migration جديدة: `ALTER TYPE order_status ADD VALUE 'awaiting_initial_quote_approval'`.
- `order-state-machine.ts`: 4 إضافات لمجموعات موجودة + انتقالين جداد.
- `CatalogService.estimate()`: فرع جديد قبل فرع `formula`.
- `InspectionQuoteService` جديدة (2 method: `submitInitialQuote`/`approveInitialQuote`) —
  إعادة استخدام كاملة لـ`PaymentsService.attemptAdditionalWorkCharge()`/`computeCommissionableBase()`.
- 2 endpoint جديد: فني (`submit-initial-quote`)، عميل (`approve-initial-quote`). الرفض بلا
  endpoint جديد (الموجود `cancel` كافي).
- **الواجهة (Flutter) مؤجّلة لدفعة لاحقة موثّقة صراحة** — الـbackend كامل ومختبر حي (curl +
  jest)، بس شاشتين جداد (الفني يدخل سعر بعد المعاينة، العميل يوافق/يرفض) محتاجين تصميم UI
  مخصّص، ومفيش Flutter SDK في بيئة السيشن دي لبناء/اختبار شاشات جديدة حيًا (بعكس تعديل نصي في
  ملف موجود). الحالة الجديدة معروضة في `OrderResponseDto.order_status` بالفعل (نفس العقد
  العام)، فأي واجهة تتبنى بعدين هتلاقي الـAPI جاهز بالكامل.

## التحقق

`inspection-then-quote.spec.ts` — اختبار حي على Postgres حقيقي: خدمة `inspection_then_quote`
حقيقية → حجز يتحصّل رسم المعاينة بس (`total_amount_cents = inspection_fee_cents`, صفر
`estimated_price_cents`) → فني يوصل → `submitInitialQuote()` ينقل الحالة وتيحدد السعر → العميل
يوافق → `total_amount_cents`/`commissionableBaseCents` يتحدّثوا صح، الحالة ترجع `IN_PROGRESS` →
مسار الرفض (`cancel()`) يشتغل من `AWAITING_INITIAL_QUOTE_APPROVAL` بلا رسوم إلغاء إضافية.
