# modules/customers

ملفات العملاء والعناوين. جداول: customer_profiles, addresses (قاموس §3.2, §4.1).

**الحالة: شغال (S2).**
- `customer_profiles` بيتعمل تلقائياً لما فني/عميل يسجل (مستمع لحدث `user.registered` من `auth`، مفيش استدعاء مباشر بين الموديولين).
- `AddressesService`/`AddressesController`: CRUD كامل على `/addresses`، بيتحقق إن المنطقة (`area_id`) مُطلقة فعلاً قبل قبول العنوان (`ORDR_001` لو لأ)، وبيحدّث `customer_profiles.default_address_id` تلقائياً.
- إحداثيات العنوان بتتخزن كـ `geography(Point)` عبر GeoJSON (`{type:'Point', coordinates:[lng,lat]}`) — TypeORM بيحوّلها لـ `ST_GeomFromGeoJSON` تلقائياً.
- اتعمله اختبار end-to-end فعلي: تسجيل عميل → إنشاء بروفايل تلقائي → إضافة عنوان في منطقة مُطلقة (نجح) → إضافة عنوان في منطقة مش مُطلقة (اترفض بالكود الصح).

## بَقّة حقيقية اتلقطت واتصلحت — `customer_profiles` الأعمدة المحسوبة كانت مجمّدة على القيمة الافتراضية للأبد

أثناء العمل على `docs/06` (صُنّاع)، اكتشفنا (موثّق أصلاً في `referrals/README.md` كملاحظة جانبية) إن
`total_orders_count`/`completed_orders_count`/`cancelled_orders_count`/`total_spent_cents`/
`first_order_at`/`last_order_at`/`average_rating_given` على `customer_profiles` **مفيش أي كود في
المشروع كله كان بيكتبلهم قيمة أبداً** — فاضلين على القيمة الافتراضية (`0`/`NULL`) للأبد منذ أول
يوم، بالظبط نفس فئة الفجوة اللي كانت موجودة قبل كده في `technician_profiles` قبل ما
`technician-stats.queue/processor.ts` يتعملوا (§14.4 في `docs/02-data-dictionary.md`: "الأعمدة
المحسوبة تتحدّث بمهمة خلفية مجدولة، مش داخل معاملة الطلب نفسها").

**الأثر الحقيقي — مش مجرد عرض ناقص في الشاشة**: `orders.service.ts` (`create()`) و
`promotions.service.ts` (`validateAndApply()`) بيستخدموا `customerProfile.totalOrdersCount === 0`
كشرط `isNewCustomer` لأكواد الخصم المقصورة على "عملاء جدد بس" (`new_customers_only`). بما إن العمود
ده مجمّد على 0 للأبد، **كل عميل — حتى بمئات الطلبات المكتملة — كان بيتحسب "عميل جديد" للأبد**،
يعني أي كود خصم `new_customers_only` كان عمليًا قابل للاستخدام من أي عميل بلا حدود، مش بس أول مرة.

**الإصلاح**: نفس نمط `technicians/technician-stats.*.ts` بالحرف —
- `customer-stats.queue.ts`/`customer-stats.processor.ts`/`customer-stats.service.ts` جداد:
  الـ processor بيعيد حساب كل الأعمدة من `orders`/`ratings` مباشرة (مش زيادة/تقليل رقم متخزّن)،
  نفس اتصال Redis المباشر (`enableOfflineQueue: false`) ونفس تسجيل خطأ الـ Worker — راجع
  `technicians/README.md` للتفاصيل الكاملة عن بَقّة BullMQ #4479 (نفس القيد موجود هنا بالضبط).
- `customer-stats-recalculation.listener.ts` جديد — بيسمع حدثين (مش واحد، عكس الفني اللي بيتنادى
  مباشرة من `payments`/`ratings`): `ORDER_CREATED_EVENT` (يحدّث `total_orders_count`/`first_order_at`
  فور الإنشاء — عميل عنده طلبات قيد التنفيذ لسه "له تاريخ طلبات"، مش عميل جديد) و
  `ORDER_STATUS_CHANGED_EVENT` (يحدّث `completed`/`cancelled_orders_count`/`total_spent_cents`/
  `last_order_at` لما الطلب يوصل لحالة نهائية: `completed` أو أي `cancelled_by_*`).
- `average_rating_given` (متوسط التقييمات اللي **العميل أعطاها** لفنيين، مش اللي استقبلها) —
  الـ trigger في `ratings.service.ts rateAsCustomer()` بس (بعد `technicianStatsService.enqueueRecalculation`
  مباشرة)، **مش** في `rateAsTechnician()`. أول نسخة من الإصلاح حطّته غلط في `rateAsTechnician()`
  (تقييم `technician_to_customer` — العميل بيستقبل مش بيدي) — اتصلحت بعد ما اختبار حي كشف إن
  القيمة فضلت صح بالصدفة بس (recompute كامل من المصدر بيرجع نفس النتيجة أيًا كان مين اللي شغّله)،
  مش لأن المكان صح فعليًا. النقلة الصح: `customer_profiles` مفيهاش عمود "متوسط التقييمات اللي
  استقبلها" أصلاً (عكس `technician_profiles.average_rating`)، فمفيش حاجة تتحدّث من `rateAsTechnician()`.
- `customers.module.ts`: `BullModule.registerQueue({name: CUSTOMER_STATS_QUEUE})`، `TypeOrmModule.forFeature`
  اتضافله `Order` (entity بس، مش استيراد `OrdersModule` كامل — نفس نمط `notifications.module.ts`
  بالظبط لتجنّب circular imports)، والـ3 providers الجداد + تصدير `CustomerStatsService` (`ratings`
  موديول محتاجه لأنه بيستدعيه من `rateAsCustomer()`).

**اتعمله اختبار حي كامل** ضد Postgres/Redis حقيقيين: عميل تجريبي جديد اتسجّل (كل الأعمدة 0/NULL
صح)، طلب أول اتعمل → `total_orders_count=1`, `first_order_at` اتسجّل فورًا (قبل أي اكتمال). نفس
الطلب اتلغى تلقائيًا من النظام (`cancelled_by_system` — مفيش فني متاح) → `cancelled_orders_count=1`.
طلب تاني اتعمل واكتمل بدفع كاش حقيقي (400 جنيه) → `total_orders_count=2`, `completed_orders_count=1`,
`total_spent_cents=40000`. **إثبات الإصلاح الفعلي للبَقّة**: كود خصم `new_customers_only=true` جديد
اتعمل من الأدمن، ومحاولة استخدامه من نفس العميل (اللي بقى عنده طلب مكتمل فعلي) **اترفضت بوضوح**
("كود الخصم ده للعملاء الجداد بس") — قبل الإصلاح كانت هتنجح دايمًا لأي عميل. طلب رابع اتعمل واكتمل
وتقيّم من العميل مرتين بقيم مختلفة (4 ثم 3 نجوم على فنيين/طلبات مختلفة) → `average_rating_given`
طابق `3.50` بالظبط ((4+3)/2)، وتقييم الفني للعميل (`technician_to_customer`) في نفس الاختبار
اتأكد إنه **مبيأثرش** على `average_rating_given` — الاتجاه صح.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
