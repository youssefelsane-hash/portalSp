# ADR-0029: هجرة حجز الشغالة/المربية للمحرك الموحّد (Phase A.4)

**الحالة:** معتمد (خطة كاملة + Slice 1 منفّذ — باقي الشرائح موثّقة تحت، لسه مفتوحة)
**التاريخ:** 2026-08-21

## السياق

Phase A.4 (docs/08 §42) — آخر شريحة في Part A، ومسمّاة صراحة في الخطة الأصلية بإنها **"الأخطر —
بيانات تاريخية حقيقية، migration لا rewrite"**. طلب مالك صريح (2026-08-21، بعد ما A.1/A.2/A.3
خلصوا): المسار النهائي لحجز الشغالة لازم يستخدم نفس بنية Service/Order/Pricing/Payment/Scheduling
المشتركة زي الحجز العادي بالظبط، **مع الحفاظ على القدرات الخاصة اللي محتاجها**: نطاق تاريخ، وقت/جدول،
أنماط تكرار، قيود كاش، وسياسة إيداع. **البيانات التاريخية لازم تفضل صحيحة ومتاحة**.

**تدقيق حي (Explore agent، أدلة ملف:سطر) قبل أي كود** أثبت الوضع الحالي بدقة:

1. `domestic_worker_bookings` جدول **منفصل تمامًا** عن `orders`/`Service` (ADR-0004، migration
   0066) — تسعيره من `DomesticWorkerProfile.hourlyRateCents`/`monthlyRateCents` (سعر شخصي لكل
   شغالة، مش سعر كتالوج)، مش من `CatalogService`/`Service.pricingModel` خالص.
2. الدفع (ADR-0019، migration 0150) بيعيد استخدام `payments`/`refunds` الموجودين فعليًا عبر نمط
   **"مرجع دفع واحد بالظبط"** (`domestic_worker_booking_id` جنب `order_id`، CHECK constraint) —
   **مش جدول دفع منفصل**. ده أهم دليل معماري في التدقيق كله: المشروع أثبت بالفعل إنه يقدر "يوسّع"
   جدول مشترك لخدمة مسار تاني بدل ما يبني نسخة موازية، ونفس النمط ده هو أساس القرار تحت.
3. التكرار الشهري (auto-renew) بتاعها آلية بديلة كاملة (`current_period_end_at`/`pending_period_end_at`
   + `sweep()`)، مش `RecurringOrderTemplate` — بينما `RecurringOrderTemplate` أصلاً بيولّد صفوف
   `orders` حقيقية عبر `OrdersService.create()` نفسها (صفر منطق تسعير/تحقق مكرر، تأكيد سابق من
   تدقيق A.1).
4. **صفر مفهوم كاش أو إيداع على حجز الشغالة خالص** — كله InstaPay يدوي التأكيد فقط (ADR-0019).
5. الفني (`DomesticWorkerProfile`) **مش** `TechnicianProfile` — كيان مستقل تمامًا، قرار ADR-0004
   المتعمّد: **صفر مطابقة تلقائية** (auto-matching) — العميل بيتصفّح ويختار شغالة بعينها مباشرة.
   القدرات المشتركة اللي المالك طلبها (Service/Order/Pricing/Payment/Scheduling) **ما ذكرتش
   محرك المطابقة صراحة** — إشارة قوية إن "زيرو مطابقة تلقائية" قرار ADR-0004 لسه سارٍ ومطلوب
   الحفاظ عليه، مش جزء من الوحدة.
6. **فجوة تقنية حقيقية موجودة بالفعل، مستقلة عن القرار ده**: تطبيقي Flutter (customer/technician)
   وشاشة الأدمن لسه ما اتحدّثوش لـADR-0019 (مفيش شاشة دفع InstaPay في تطبيق العميل، `awaiting_payment`
   مش معروفة في خرائط الحالة). التدقيق وثّق ده صراحة — مش مسؤولية ADR ده يصلحه، بس لازم يتوثّق
   كفجوة موجودة قبل ما نبني فوقها.

## القرار

### 1. `orders`/`Service` هما البنية النهائية — `domestic_worker_bookings` تاريخي فقط، صفر حذف

**زيرو migration رجعي للبيانات القديمة، للأبد** — مش بس أثناء فترة انتقالية. أي حجز شغالة موجود
دلوقتي (بأي حالة) يفضل صف حقيقي في `domestic_worker_bookings`، يتقرا ويتعدّل بنفس الكود الحالي
(`DomesticWorkerBookingsService`, `DomesticWorkersController`, تطبيقي Flutter) للأبد. الحجوزات
الجديدة (بعد إطلاق المسار الموحّد) بس هي اللي تتسجّل كصفوف `orders` — قرار "migrate forward"، مش
"rewrite backward"، بالظبط زي ما طلب المالك بالحرف.

### 2. نموذج تسعير جديد: `PricingModel.WORKER_RATE`

`Service.pricingModel` بياخد قيمة enum جديدة `worker_rate` (نفس نمط إضافة `fawry_reference` لـ
`payment_method` في migration 0042 — `ALTER TYPE ... ADD VALUE`، آمن جوّه transaction، القيمة
الجديدة ما بتتستخدمش في نفس الـmigration). خدمة بالنموذج ده معناها: **السعر مش من الكتالوج خالص**
(`base_price_cents` بيتحط 0 ومالوش معنى) — لازم فني (شغالة) يتحدد الأول، والسعر بيتحسب من معدّلها
الشخصي (`hourlyRateCents × duration_hours` أو `monthlyRateCents` كامل). `CatalogService.estimate()`
بتاخد فرع جديد (append-only، نفس نمط `FORMULA`/`technicianPricingTier` بالحرف): باراميتر اختياري
جديد `precomputedWorkerRateCents` — لو الخدمة `WORKER_RATE`، الدالة بترجّع القيمة دي مباشرة كـ
`estimated_total_cents`، **بلا `levelMultiplier` أو zone override خالص** (قرار متعمّد: سعر الشغالة
المختارة هو السعر النهائي المتفق عليه شخصيًا، مش سعر كتالوج قابل للتعديل بمستوى/منطقة — الشغالات
مالهاش `TechnicianLevel` أصلاً). الحساب الفعلي (`hourlyRateCents × duration_hours`) بيحصل في
الـcaller (`OrdersService.create()`/`previewPrice()`) لما يوصلهم فني الشغالة المختار — نفس فلسفة
فصل المسؤوليات الموجودة (`CatalogService` ماعندهاش أي علم بـ`DomesticWorkerProfile`).

### 3. تمثيل الفني: `orders.domestic_worker_profile_id` (عمود جديد، مش `TechnicianProfile`)

`DomesticWorkerProfile` **تفضل كيان مستقل بالكامل** — صفر تحويلها لـ`TechnicianProfile` (كان
هيكسر مطابقة/مستويات/مناطق/فرق التكنيشن كلها بلا داعي، ومخالف لقرار ADR-0004 المتعمّد "زيرو
مطابقة"). بدل كده: `orders.domestic_worker_profile_id` (`uuid NULL REFERENCES domestic_worker_profiles(id)`)
— **نفس نمط "مرجع واحد بالظبط" اللي ADR-0019 أثبته بالفعل على `payments`/`refunds`**، هنا بمعنى
أخف: مش CHECK صارم (orders عادي `technician_id` ليها معنى تاني: ممكن تبقى null فترة `SEARCHING_TECHNICIAN`)،
بس **قاعدة عمل واضحة**: طلب بـ`domestic_worker_profile_id IS NOT NULL` معناه `technician_id` يفضل
`NULL` دايمًا (الشغالة مش فني، مفيش أي مسار يحطها هناك) — الفحص ده هيتفرض في Slice 2 (تحت) وقت
`OrdersService.create()`.

### 4. الدفع: صفر كود جديد — `cash_allowed`/`deposit_required`/`deposit_percentage` بيتطبقوا زي أي خدمة

خدمة شغالة جديدة تتعمل بـ`cash_allowed=false` (مطابقة لواقع InstaPay-only الحالي بالظبط، ADR-0019)
و`deposit_required` اختياري (قدرة **جديدة** حقيقية مش موجودة في المسار القديم خالص — مثلاً إيداع
لحجز شهري مقيم). بما إن الطلب بيعدّي بنفس `OrdersService.create()` → `PaymentsService.amountOwedNow()`
اللي A.1/A.3 بنوهم بالفعل، **الميزتين شغالتين تلقائيًا بلا سطر كود إضافي** — أقوى دليل عملي إن
التوحيد بيحقق وعده الأساسي (بناء فوق الأنظمة الموجودة، مش جنبها).

### 5. الجدولة/التكرار: إعادة استخدام كاملة، صفر محرك جديد

- **تاريخ/وقت**: `scheduled_at`/`scheduled_at_range_end` (A.2) بالظبط زي أي طلب عادي —
  `allows_date_range_booking` قدرة قابلة للتفعيل لخدمة الشغالة لو الأدمن عايز.
- **تكرار شهري (live-in)**: `RecurringOrderTemplate` (`frequency=monthly`) بدل آلية
  `current_period_end_at`/`sweep()` البديلة — بيولّد صف `orders` جديد كل شهر عبر
  `OrdersService.create()` نفسها. **حجوزات شهرية قديمة (قبل الهجرة) تفضل شغالة بآلية `sweep()`
  الحالية للأبد** — صفر نقل قسري.

### 6. ترتيب الشرائح الآمن (small safe slices، نفس منهجية A.1→A.3 بالحرف)

- **Slice 1 (هذا الـcommit)**: الأساس الآمن بالكامل — `ALTER TYPE pricing_model ADD VALUE
  'worker_rate'` + `orders.domestic_worker_profile_id` (migration 0166) + `Order.domesticWorkerProfileId`
  entity field + فرع `CatalogService.estimate()` الجديد (معزول، قابل للاختبار مباشرة، صفر تغيير
  على أي فرع تاني). **صفر endpoint جديد، صفر تغيير سلوك لأي مسار موجود** — القيمة الجديدة
  `worker_rate` مش مستخدمة في أي `Service` حقيقي لسه.
- **Slice 2 (التالية، مش منفّذة هنا)**: `OrdersService.create()` — فرع "تخطي المطابقة" لما
  `dto.domestic_worker_profile_id` موجودة (تحميل الفني، حساب السعر من معدّله، إنشاء الطلب بحالة
  معيّنة مباشرة بدل `SEARCHING_TECHNICIAN`). **هي الأخطر فعليًا** — لازم بحث مستقل قبلها في كل
  الآثار الجانبية اللي بتحصل حاليًا وقت قبول فني عادي (إنشاء شات، إشعارات، حجز سلوت، إحصائيات) عشان
  الطلب المُعيَّن مباشرة يوصل لنفس الحالة الوظيفية الكاملة، مش يفضل ناقص آثار جانبية بصمت. الخيارين
  المرشّحين: (أ) الطلب بيتسجّل مباشرة `TECHNICIAN_ASSIGNED` وبتتنفّذ نفس effects دالة القبول يدويًا،
  أو (ب) الطلب بيتسجّل `SEARCHING_TECHNICIAN` عادي بس بمرشّح واحد بس (الشغالة المختارة) والمطابقة
  الحالية بتقبلها فورًا (إعادة استخدام أكبر، بس محتاج تأكيد إن منطق "قبول" الحالي مش مربوط بافتراضات
  خاصة بـ`TechnicianProfile`). **قرار مؤجَّل عمدًا لحد ما البحث ده يتم** — مش تكاسل، ده بالظبط نوع
  القرار اللي محتاج تصميم كافٍ قبل الكود (نفس فلسفة تأجيل الإيداع من ADR-0026 لحد ما ADR-0027 اتكتب).
- **Slice 3**: واجهات حقيقية (Flutter + أدمن) لمسار الحجز الجديد — أكبر شغل UI، بعد ما Slice 2
  يثبت نفسه حيًا.
- **Slice 4**: `RecurringOrderTemplate` لتجديد الحجز الشهري بالمسار الجديد.
- **مؤجّل بلا التزام بتاريخ**: إيقاف endpoint الإنشاء القديم (`DomesticWorkerBookingsService.create()`)
  — بس بعد ما المسار الجديد يثبت نفسه إنتاجيًا لفترة كافية، وبقرار مالك صريح وقتها. الحجوزات
  التاريخية تفضل متاحة للأبد بغض النظر عن قرار الإيقاف ده.

## البدائل اللي اتقيّمت

- **تحويل `DomesticWorkerProfile` لـ`TechnicianProfile` بعلم مميّز** — رُفض. كان هيفعّل محرك
  المطابقة/المستويات/المناطق/الفرق بالكامل لكيان المفروض "زيرو مطابقة" له (قرار ADR-0004 صريح)،
  وهيحتاج استثناءات كتير في كل مكان (matching، workforce matrix، إلخ) بدل تبسيط. المالك ماطلبش
  توحيد محرك المطابقة، طلب توحيد Service/Order/Pricing/Payment/Scheduling — قايمة واضحة استُخدمت
  حرفيًا هنا.
- **جدول `orders` منفصل لحجز الشغالة (`domestic_worker_orders`) بدل عمود على `orders` الموجود** —
  رُفض. بالظبط عكس طلب "نفس بنية Order المشتركة" — كان هيبقى تكرار الجدول القديم بس باسم جديد،
  صفر توحيد فعلي.
- **هجرة كل البيانات التاريخية لـ`orders` دلوقتي (rewrite)** — رُفض بشدة، صراحة برضه في طلب المالك
  ("Migration لا rewrite... البيانات التاريخية لازم تفضل صحيحة ومتاحة"). هجرة بيانات تاريخية حقيقية
  (أرباح مدفوعة، تقييمات، سجل نزاعات) لجدول تاني هي بالظبط النوع اللي بيكسر تاريخ حقيقي بلا داعي.
- **بناء Slice 2 (تخطي المطابقة) في نفس الـcommit ده** — رُفض بعد تقييم دقيق. الآثار الجانبية
  لقبول فني (شات/إشعارات/سلوت/إحصائيات) موزّعة في أماكن كتير، وتكرارها يدويًا بلا بحث مخصص خطر
  حقيقي (سلوك ناقص بصمت). "شرايح آمنة صغيرة" (طلب المالك صراحة) يعني الأساس المعزول أولاً، الجزء
  الأخطر لوحده بعده بتصميم كافٍ — بالظبط نفس ترتيب A.1→A.2→A.3.

## الأثر (Slice 1، منفّذ في الـcommit ده)

- Migration جديدة (0166): `ALTER TYPE pricing_model ADD VALUE 'worker_rate'` +
  `orders.domestic_worker_profile_id` (nullable FK) — صفر كسر لأي خدمة/طلب موجود، صفر استخدام فعلي
  للقيمة الجديدة لسه.
- `CatalogService.estimate()`: فرع جديد لـ`PricingModel.WORKER_RATE` + باراميتر اختياري جديد —
  append-only بالكامل، صفر تغيير على أي فرع تسعير موجود.
- `Order.domesticWorkerProfileId`: عمود جديد، مش مقروء/مكتوب من أي كود لسه (Slice 2).
- اختبار حي جديد لفرع `estimate()` الجديد (منعزل، بلا حاجة لـ`OrdersService`/بيانات fixture معقدة).
- **صفر تغيير على `domestic-workers` module الحالي بالكامل** — `DomesticWorkerBookingsService`،
  الـcontrollers، تطبيقي Flutter، كله زي ما هو بالظبط.
