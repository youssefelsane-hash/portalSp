# ADR-0004: قطاع الخدمات المنزلية — كيان مستقل تمامًا، مش امتداد لـ`technicians`/`orders`

**الحالة:** معتمد
**التاريخ:** 2026-08-12

## السياق

المالك طلب قطاع جديد: شغالة تنظيف بالساعة، Baby sitter بالساعة، مقيمة بالشهور (live-in). راجع `docs/08-pricing-engine-and-platform-vision.md` §12 — موثّق صراحة كـ"مختلف جوهريًا عن نموذج 'طلب صيانة' الحالي"، ونطاق منتج مستقل يتاخد بعد ما باقي الرؤية تخلص.

## القرار

**كيان مستقل بالكامل — `user_type` جديد، جداول جديدة، صفر إعادة استخدام لـ`technician_profiles`/`orders`/`matching`.**

1. **`UserType.DOMESTIC_WORKER` قيمة enum جديدة** (`ALTER TYPE user_type ADD VALUE`) — مش إعادة استخدام `technician` (كان هيخلط شغالة/مربية مع فني صيانة في نفس الـ`@Roles(TECHNICIAN)` guards المستخدمة في كل موديول `technicians`/`orders`/`matching`)، ومش إعادة استخدام `partner` الموجودة (دي موثّقة في `docs/02-data-dictionary.md` §"laundry_partners" لشركات مغاسل/تنظيف B2B، مفهوم تاني تمامًا).
2. **`domestic_worker_profiles` جدول مستقل** — مش عمود إضافي على `technician_profiles`. الأسباب: (أ) حقول التسعير مختلفة جوهريًا (سعر بالساعة + سعر شهري ثابت، مش `service_zone_pricing`/`pricing_engine`)، (ب) مفيش مطابقة تلقائية (`matching.service.ts`) — العميل بيختار الشغالة بنفسه من قايمة تصفّح (نفس فلسفة §3 اختيار الفني، بس بدون auto-match بديل خالص)، (ج) `verification_status` أبسط (pending/approved/rejected/suspended) — مفيش `test_passed`/مستويات فنيين هنا.
3. **`domestic_worker_bookings` جدول مستقل — مش `orders`**. الحجز نوعين جوهريًا مختلفين عن "طلب صيانة" (زيارة واحدة قصيرة): حجز بالساعة (تاريخ+وقت+مدة) وحجز شهري مقيم (تاريخ بدء + تجديد تلقائي + `current_period_end_at`). دمجهم في `orders` كان هيحتاج تلغيم `order_type`/`OrdersService.create()` بحقول مش منطقية لباقي الأنواع (مفيش `service_zone_id`، مفيش `estimated_price_cents` بمعنى الكتالوج، إلخ).
4. **دفع حقيقي عبر `WalletsService.doubleEntry()` الموجودة** — تأكيد الشغالة/المربية للحجز بيحصّل السعر فورًا من محفظة العميل لمحفظة المنصة (زي `payWithWallet`)، وأرباح الشغالة بتتحوّل عند الاكتمال (بالساعة) أو عند كل تجديد شهري ناجح (مقيم) — نفس نمط `settleAndComplete`. عمولة منفصلة قابلة للتعديل (`commission.domestic_worker_percentage`).
5. **التجديد التلقائي الشهري عبر فحص دوري (`setInterval`)، مش BullMQ** — نفس فلسفة `OrderAutoCancelService`/`RecurringOrdersService` بالحرف (تفادي الاعتماد على Worker عنده بَقّة recovery موثّقة). فشل التجديد (رصيد غير كافٍ) بيوقف `auto_renew` تلقائيًا ويسيب الحجز يفضل نشط لحد `current_period_end_at` بعدين يقفل — نفس سلوك أي اشتراك حقيقي (مش إعادة محاولة لا نهائية)، قرار معقول غير مخترع بلا داعي.

## نطاق متعمّد برّه v1 (موثّق صراحة، مش سهو)

- **التقييمات**: `ratings.order_id` `NOT NULL UNIQUE REFERENCES orders(id)` — تعديل الجدول ده (nullable + عمود جديد لحجز شغالة) بتاثير على نظام مالي/تقييمي أساسي مستخدم بكثافة، قرار مؤجل عمداً لمرحلة تانية بعد ما القطاع نفسه يثبت. `average_rating`/`total_ratings_count` موجودين على `domestic_worker_profiles` كأعمدة جاهزة (زي أعمدة راكدة أخرى شافيناها قبل كده) لحد ما التكامل يتبنى.
- **تكامل كاميرات المراقبة** — المصدر الأصلي نفسه بيقول "مش لازم تظهر في الواجهة"، ومفيش مزوّد/API محدد. صفر تكامل في v1.
- **مطابقة تلقائية (auto-match)** — العميل بيتصفّح ويختار بنفسه، زي §3، مش خوارزمية اختيار تلقائي.

## الأثر

- Migration جديدة: `user_type` enum + `domestic_worker_specialty` enum + `domestic_worker_verification_status` enum + `domestic_worker_booking_status` enum + `domestic_worker_booking_type` enum + `domestic_worker_profiles` + `domestic_worker_bookings` + إعداد عمولة جديد.
- موديول جديد مستقل `apps/api/src/modules/domestic-workers/` — بيستخدم `WalletsService`/`CustomerProfilesService`/`AddressesService` الموجودين بس، مش `OrdersService`/`TechniciansService`/`MatchingService`.
