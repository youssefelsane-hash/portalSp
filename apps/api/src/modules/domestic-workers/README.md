# modules/domestic-workers

قطاع الخدمات المنزلية (docs/08 §12، `docs/adr/0004-domestic-workers-vertical.md`) — شغالة تنظيف بالساعة، Baby sitter بالساعة، مقيمة بالشهور. **كيان مستقل بالكامل عن `technicians`/`orders`/`matching`** — القرار الكامل وأسبابه في الـ ADR، أهمها: `UserType.DOMESTIC_WORKER` قيمة enum جديدة (مش `technician` ولا `partner` الموجودة أصلاً لـ`laundry_partners`)، جداول جديدة تمامًا (`domestic_worker_profiles`, `domestic_worker_bookings`، migration `0066`)، ودفع حقيقي عبر `WalletsService.doubleEntry` الموجودة (مش نظام دفع مواز).

## التسجيل والبروفايل

- التسجيل عبر `POST /auth/register` العادي بـ`user_type=domestic_worker` — بروفايل فاضي (`specialties=[]`) بيتعمل تلقائيًا (`DomesticWorkerProfileListener`، نفس نمط `TechnicianProfileListener` بالحرف) بكود `DW-2026-000001` (نفس `next_human_readable_number` المستخدمة في `ORD`/`EMP`/`BLD`).
- `PATCH /domestic-worker/profile` — بيو/سنين خبرة/تخصصات (`cleaning_hourly`/`babysitting_hourly`/`live_in_maid_monthly`، array من enum ثابت)/أسعار. **فحص صريح**: تخصص بالساعة لازم معاه `hourly_rate_cents`، تخصص شهري لازم معاه `monthly_rate_cents` — وإلا `400` واضح.
- `POST /domestic-worker/request-review` → `GET/POST /admin/domestic-workers[/:id/review]` (نفس صلاحية `technicians.review_documents` — نفس نوع القرار approve/reject بالظبط، مش صلاحية جديدة).
- `GET /domestic-workers?specialty=&latitude=&longitude=` (عام للعميل) — معتمدين ومتاحين بس، ترتيب بالتقييم ثم القرب (`ST_Distance` حقيقي، نفس فلسفة اختيار الفني §3).

## الحجوزات (`domestic_worker_bookings`)

نوعين جوهريًا مختلفين، مش `orders`:

- **بالساعة** (`hourly`): تاريخ+وقت+عدد ساعات، السعر = `hourly_rate_cents × duration_hours`.
- **شهري مقيم** (`monthly_live_in`): تاريخ بدء + `auto_renew`، السعر = `monthly_rate_cents` ثابت لكل شهر.

**دورة الحياة**: `pending_confirmation` → (الشغالة بتأكّد، `POST /domestic-worker/bookings/:id/confirm`) → **تحصيل فوري حقيقي** من محفظة العميل لمحفظة المنصة، وأرباح الشغالة (بعد خصم `commission.domestic_worker_percentage`، افتراضي 15%) بتتحول فورًا لمحفظتها → `confirmed` (بالساعة) أو `active` (شهري، مع `current_period_end_at = +شهر`). بالساعة: `POST /domestic-worker/bookings/:id/complete` (الشغالة تقفل الزيارة، مفيش تحصيل تاني) → `completed`. شهري: `sweep()` دوري بيجدّد كل شهر تلقائيًا.

- **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي**: تحويل أرباح الشغالة (منصة→شغالة) كان بيترفض بـ`PAY_002` "رصيد غير كافٍ" لأن محفظة المنصة نفسها كانت برصيد سالب (طبيعي في بيئة اختبار فيها قيود يدوية كتير) — نفس السبب بالظبط اللي `payments.service.ts`'s `settleAndComplete` بيحله بـ`allowNegativeBalance:true` ("محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود"). اتصلحت بإضافة نفس الـ flag هنا.
- **التجديد الشهري التلقائي عبر فحص دوري (`setInterval` كل دقيقة)، مش BullMQ** — نفس فلسفة `OrderAutoCancelService`/`RecurringOrdersService` بالحرف. `sweep()` بيدوّر على عقود `active`+`auto_renew=true` وصل `current_period_end_at`، بيحاول يحصّل الشهر الجاي (`chargeCustomerAndPayWorker` نفسها المستخدمة وقت `confirm()`)، ولو نجح بيمدّ الفترة شهر. **فشل التحصيل (رصيد غير كافٍ عادة) بيوقف `auto_renew` تلقائيًا** — مفيش إعادة محاولة لا نهائية، نفس أي اشتراك حقيقي. عقود `active`+`auto_renew=false` وصلت لنهاية فترتها بتتقفل `completed` تلقائيًا (مش تفضل معلّقة للأبد).
- **الإلغاء**: `POST /domestic-worker-bookings/:id/cancel` (العميل) — مسموح قبل الإكمال/الإلغاء. **مفيش استرداد جزئي تلقائي في v1** لو الحجز اتأكد بالفعل (اتحصّل فعلاً) — قرار متعمّد، سياسة استرداد مفصّلة مش موجودة في المصدر الأصلي لهذا القطاع، مش هتتخترع.

## نطاق متعمّد برّه v1 (موثّق صراحة في ADR-0004)

- **التقييمات** — `average_rating`/`total_ratings_count` موجودين على `domestic_worker_profiles` كأعمدة جاهزة، بس مفيش endpoint تقييم مربوط بيهم لسه. `ratings.order_id` `NOT NULL UNIQUE` مربوطة بـ`orders` تحديدًا — تعديلها قرار مؤجل عمداً لمرحلة تانية (نفس فلسفة عدم لمس جدول مالي/تقييمي أساسي تحت ضغط وقت).
- **تكامل كاميرات المراقبة** — المصدر الأصلي نفسه بيقول "مش لازم تظهر في الواجهة"، ومفيش مزوّد محدد. صفر تكامل.
- **مطابقة تلقائية (auto-match)** — العميل بيتصفّح ويختار بنفسه، زي §3، مش خوارزمية اختيار.

## اتعمله اختبار حي كامل

شغالة حقيقية اتسجّلت (`user_type=domestic_worker`) → بروفايل فاضي اتعمل تلقائيًا (`DW-2026-000001`) → كمّلت بروفايلها (تخصصين، أسعار) → طلبت مراجعة → أدمن وافق. عميل تصفّح ولقاها مرتّبة بالتقييم/القرب صح (`distance_km` حقيقي محسوب). حجز بالساعة (3 ساعات × 150 جنيه) → تأكيد الشغالة → **بَقّة اتلقطت واتصلحت** → تأكيد نجح، محفظة العميل اتخصم 450 جنيه بالظبط، محفظة الشغالة اتضاف لها 382.50 جنيه بالظبط (85% بعد عمولة 15%) → إكمال الزيارة → `completed_bookings_count` بقى 1. حجز شهري مقيم (8000 جنيه) → تأكيد → تحصيل الشهر الأول → **الفحص الدوري جدّد تلقائيًا** بعد ما `current_period_end_at` استحق (تحصيل تاني 8000 جنيه، مدّ الفترة شهر بالظبط) → لما الرصيد بقى مش كافي للتجديد التالي، `auto_renew` اتوقف تلقائيًا والحجز اتقفل `completed` (مفيش فترة معلّقة). إلغاء حجز `pending_confirmation` نجح من غير تحصيل. تخصص غلط اترفض `400` بوضوح.

## بَقّتين حقيقيتين اتلقطوا واتصلحوا (2026-08-13)

- **`chargeCustomerAndPayWorker()` كانت بتنادي `WalletsService.doubleEntry()` مرتين منفصلتين من
  غير `manager` مشترك** (خصم العميل، بعدين إيداع الشغالة) — لو الأولى نجحت والتانية فشلت (خطأ DB
  عابر)، العميل بيتخصم منه فعليًا والشغالة ما بتاخدش فلوسها، من غير rollback. الإصلاح: الاتنين
  دلوقتي جوّه `dataSource.transaction()` واحدة (نفس نمط `PaymentsService.settleAndComplete()`) —
  فشل أي طرف بيرجع الاتنين مع بعض.
- **`addMonths()` (تجديد العقد الشهري المُقيم) كانت عندها نفس بَقّة فيضان الأيام** الموثّقة في
  `../orders/README.md` (§"الجدولة المستقبلية/المتكررة") — `setMonth` بيفيض بصمت لو اليوم مش
  موجود في الشهر الجديد. الإصلاح: نفس أسلوب `clamp` على آخر يوم فعلي في الشهر الجديد.

مرجع كامل: `../../../../docs/08-pricing-engine-and-platform-vision.md` §12 و`../../../../docs/adr/0004-domestic-workers-vertical.md`.
