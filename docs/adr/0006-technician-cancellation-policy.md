# ADR-0006: سياسة إلغاء الفني القابلة للإعداد (Technician Cancellation Policy)

**الحالة:** معتمد
**التاريخ:** 2026-08-12

## السياق

`OrdersService.technicianCancel()` (`POST /technician/orders/:id/cancel`) الموجودة حاليًا بسيطة جدًا: سبب اختياري + رسوم إلغاء بس، **hardcoded بالكامل** — مفيش نافذة زمنية، مفيش فرق في السلوك حسب `booking_mode`، مفيش صلاحيات هرمية للفريق، ومفيش سلوك استرجاع/إعادة توزيع بعد الإلغاء (الطلب بيتلغي نهائي بس، العميل لازم يحجز طلب جديد من الأول). المالك طلب صراحة (بالتفصيل الكامل موثّق في `docs/10-integration-completion-tracker.md` §"سياسة إلغاء الفني") سياسة كاملة قابلة للإعداد من لوحة الأدمن، مش قيم ثابتة في الكود.

## القرار

### 1. الإعدادات (`settings` الموجود، `group_name='technician_cancellation'`)

- `technician_cancellation.self_cancel_enabled` (boolean, افتراضي `true`) — مفتاح إيقاف عام لإلغاء الفني الذاتي بالكامل.
- `technician_cancellation.window_minutes_after_acceptance` (number, افتراضي `15`) — الإلغاء الذاتي مسموح بس لو `now - accepted_at <= window`. `0` = بلا حد زمني (قرار إداري صريح، مش سهو).
- `technician_cancellation.min_minutes_before_scheduled_start` (number, افتراضي `60`) — لو الطلب `scheduled_at` مضبوط، الإلغاء ممنوع لو باقي أقل من كده على الموعد.
- `technician_cancellation.auto_rematch_individual` (boolean, افتراضي `true`) — طلبات `booking_mode IN (individual, emergency)` بعد إلغاء الفني بترجع تلقائيًا لـ`searching_technician` (نفس محرك `dispatchNextRound()` الموجود، بعد استبعاد الفني اللي لغى صراحة).
- `technician_cancellation.auto_rematch_team_assigned` (boolean, افتراضي `false`) — لو `false` (الافتراضي)، الطلبات اللي الفني اتعيّن عليها بـ"اعتماد" (`booking_mode=team`) أو تعيين يدوي من الأدمن (`AdminOrdersService.reassign()`) **مبترجعش تلقائي للمطابقة** — بتتحول لحالة `needs_technician_reselection` جديدة، والعميل ياخد إشعار + deep link لقايمة فنيين/شركات بديلة يختار منها بنفسه. تفعيل الإعداد ده بيخلي السلوك زي `individual` بالظبط (auto-rematch صامت).

كل الإعدادات دي `is_public=false` (تشغيلية، مش للعرض العام) — نفس نمط `matching.*`.

### 2. `order_status` قيمة جديدة: `needs_technician_reselection`

بديل عن اختراع جدول/آلية منفصلة. الانتقالات المسموحة (`order-state-machine.ts`):
- `ACCEPTED | TECHNICIAN_ON_WAY | TECHNICIAN_ARRIVED → NEEDS_TECHNICIAN_RESELECTION` (بس لو `auto_rematch_team_assigned=false` والطلب مش مؤهّل لإعادة المطابقة التلقائية — راجع #1).
- `NEEDS_TECHNICIAN_RESELECTION → SEARCHING_TECHNICIAN` — العميل بيطلب إعادة المطابقة صراحة (`POST /orders/:id/request-rematch` جديد، بيقبل `requested_technician_id` اختياري — **تفضيل بس مش ضمان**، نفس فلسفة `requested_technician_id` الموجودة أصلاً في كل مكان تاني بالمشروع، مش اختراع "حجز مضمون لفني بعينه" مبدأ جديد).
- `NEEDS_TECHNICIAN_RESELECTION → CANCELLED_BY_CUSTOMER` — العميل يقدر يلغي الطلب كله بدل ما يعيد الاختيار (زرار "إلغاء" العادي بيفضل شغال، `CUSTOMER_CANCELLABLE_STATUSES` هتضاف الحالة الجديدة).

### 3. تحديد "هل الطلب ده كان تعيين يدوي/اعتماد؟"

مفيش عمود جديد — بنستنتجها من إشارتين موجودتين بالفعل، بدل ما نخترع schema إضافي لحاجة ممكن تُستنتج:
- `order.bookingMode === BookingMode.TEAM` ("اعتماد" — العميل اختار شركة/فريق بعينه صراحة وقت الحجز).
- أو صف `order_status_history` بـ`change_source=admin` و`new_status=accepted` (بصمة `AdminOrdersService.reassign()` الموجودة من زمان — التعيين اليدوي من الإدارة).

لو أي واحدة من الاتنين true **و** `auto_rematch_team_assigned=false` → `needs_technician_reselection`. غير كده (booking_mode=individual/emergency عادي) → إعادة مطابقة تلقائية صامتة.

### 4. صلاحيات هرمية للفريق

الـendpoint (`POST /technician/orders/:id/cancel`) فضل مقصور على **الفني المُعيَّن على الطلب نفسه بس** (`order.technicianId`) — مفيش تغيير هنا. "قائد/مدير الفريق يقدر يلغي نيابة عن عضو تاني" **مؤجَّل عمدًا** — محتاج قرار عمل صريح (هل ده "انتحال" لحساب الفني التاني، ولا endpoint إداري منفصل بصلاحية `orders.reassign` الموجودة أصلاً؟) مش هيتخترع من غير تأكيد من المالك. موثّق كفجوة صريحة في `orders/README.md`.

### 5. السبب إجباري + نص حر عند "أخرى"

`cancellation_reasons` جدول موجود من زمان (`applies_to`, `charges_fee`, `fee_percentage`). عمود جديد `requires_free_text` (boolean, افتراضي `false`) — لو `true`، الـDTO بيرفض بوضوح لو `reason` (نص حر) فاضي. `dto.cancellation_reason_id` بقى **إجباري** (مكانش، هيتغيّر).

### 6. حدث audit كامل

`AuditLogService.record()` الموجود (مش عمود جديد) — `newValues` بتحمل كل الحقول المطلوبة صراحة: `accepted_at`, `cancelled_at`, `elapsed_minutes_since_acceptance`, `within_policy_window`, `booking_mode`, `rematch_behavior` (`auto` | `needs_reselection`). نفس فلسفة بقية الـaudit في المشروع — بيانات تاريخية للمراجعة، مش state بيتقرأ في مسار العملية الحقيقية.

## البدائل اللي اتقيّمت

- **جدول `technician_cancellation_policies` منفصل بدل `settings`**: رُفض — نفس مبرر كل الإعدادات التانية في المشروع (`matching.*`, `referral.*`, ...)، `settings` جدول key-value عام مُصمَّم بالظبط لكده، تكرار جدول جديد بلا داعي.
- **عمود `orders.original_booking_source` جديد بدل الاستنتاج من `booking_mode`/`order_status_history`**: رُفض — البيانات موجودة بالفعل، عمود جديد تكرار بلا قيمة إضافية.
- **إعادة مطابقة تلقائية صامتة للكل بلا استثناء (تجاهل التفرقة individual/team)**: رُفض صراحة — يخالف طلب المالك المباشر ("مفيش تعيين فني تاني صامت إلا لو سياسة/إعداد صريح بيسمح" للحالة اليدوية).

## الأثر

- Migration جديدة (`0068`): `ALTER TYPE order_status ADD VALUE 'needs_technician_reselection'` + `ALTER TABLE cancellation_reasons ADD COLUMN requires_free_text` + `INSERT INTO settings` (6 صفوف `technician_cancellation.*`).
- `order-state-machine.ts`: انتقالات جديدة زي فوق.
- `OrdersService.technicianCancel()`: إعادة بناء كاملة (نافذة زمنية، حد أدنى قبل الموعد، تحقق سبب/نص، سلوك استرجاع حسب booking_mode).
- Endpoint جديد: `POST /orders/:id/request-rematch` (عميل).
- `apps/technician-app`: زرار الإلغاء يتقيّد بالسياسة (يختفي لو برّه النافذة)، تأكيد نهائي، سبب+نص.
- `apps/customer-app`: إشعار + شاشة/كارت لحالة `needs_technician_reselection` مع خيار إعادة المطابقة أو الإلغاء.
- **نطاق مؤجَّل صراحة عن هذا الـADR (مش سهو)**: قائد/مدير الفريق يلغي نيابة عن عضو تاني (محتاج قرار عمل)، شاشة "اختيار فني بديل" الكاملة (تصفّح+حجز مباشر) في customer-app — النسخة الأولى بتكتفي بزرار "أعد المطابقة" بسيط.
