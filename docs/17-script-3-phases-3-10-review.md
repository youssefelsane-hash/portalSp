# Script 3 — مراجعة Phases 3-10 (guided intake → price → provider → review → payment → active order → history)

مراجعة صريحة (مش re-verify شامل من الصفر — الشاشات دي راجعت بعمق في جلسات سابقة، task #39/#48
في تتبّع المهام) ضد بنود §16-§57 من سبيسفيكيشن Script 3. الحكم: **الأغلبية الساحقة مبنية صح من
قبل** — الفجوة الحقيقية الوحيدة اللي Script 3 بيطلبها صراحة كانت ترتيب دخول الحجز (اتصلحت في
Phase 2). باقي البنود اتفحصت هنا بالتحديد لأنها لُبس محتمل أو "بَقّة معروفة" مذكورة صراحة في
السبيسفيكيشن.

## §45 — الكاش لازم يتعامل كطريقة دفع شرعية (السبيسفيكيشن بيطلب صراحة "re-test the known cash cancellation issue")

**اتأكد — مش فجوة.** `OrdersService.create()` بتحدد `PENDING_PAYMENT` بس لو
`requiresPrepay = Boolean(requestedPrepayMethod) && totalAmountCents > 0` — الكاش مالوش
`requestedPrepayMethod` أصلاً، فبيروح `SEARCHING_TECHNICIAN` مباشرة. `OrderAutoCancelService.sweepPendingPayment()`
بتلغي بس طلبات `PENDING_PAYMENT` القديمة — طلبات الكاش مستحيل توصلها أصلاً. **البنية الحالية
صحيحة بنيويًا، الـ"بَقّة المعروفة" مش قابلة للتكرار في الكود الحالي.**

## §46 — حالات الدفع الإلكتروني (Processing/Confirmed/Pending/Failed، مش "فشل" مبكر كاذب)

**اتأكد — مش فجوة.** `card_payment_screen.dart`'s `_CheckState` (idle/checking/confirmedPaid/**stillPending**)
— لاحظ مفيش حالة `failed` أصلاً. لو 5 محاولات (كل 2 ثانية) مالقتش `payment_status=paid`، بيعرض
بانر واضح "لسه مبيّن إن الدفع اتأكّد... هيتحدّث تلقائي" — **مايدّعيش فشل أبدًا لو النتيجة لسه غير
مؤكدة**، بالظبط مطلوب §46. لا تغيير مطلوب.

## §49 — جدول زمني مقروء بشري (مش enums خام)

**اتأكد — مش فجوة.** `orderStatusLabelsAr` (`orders/models.dart`) خريطة عربية كاملة لكل الـ18 حالة
طلب ممكنة، معلّقة صراحة "لازم تعريب أي enum خام من الباك-إند قبل ما يوصل للمستخدم" — مبدأ تصميم
مُطبّق فعليًا مش شعار بس.

## §50 — سبب إلغاء آمن للعميل (مش تفاصيل تقنية داخلية)

**اتأكد — مش فجوة.** `CancellationReason.reasonAr` حقل عربي مخصص للعميل، منفصل عن أي بيانات
تدقيق داخلية (actor/automation rule موجودين بس في `audit_log`، مش في الرد اللي بيوصل للعميل).

## §31 — العمل الإضافي (موافقة/رفض صريح، الفني مايقدرش يغيّر الإجمالي بنفسه)

**مغطّى من قبل** — `additional_work_proposal_lifecycle` (migration Script 1) + الشاشات المرتبطة
في `order_detail_screen.dart` مبنية على نفس الـsubsystem المستقر، اتأكدت واختبرت في جلسات سابقة
(راجع `docs/14`). مفيش تعديل هنا.

## الخلاصة

Phases 3-10 محتاجة REFINE بسيط جدًا مش REDESIGN — البنية والمنطق صح من قبل، والتعديل الوحيد
الحقيقي اللي Script 3 طلبه (نقل سؤال وضع الحجز) اتنفّذ في Phase 2. الجهد المتبقي الحقيقي في
Script 3 مُركّز في Phase 11 (Customer Web — مش موجودة خالص) وPhase 12-13 (فحص أداء/إتاحة/RTL
صريح + validation نهائي).
