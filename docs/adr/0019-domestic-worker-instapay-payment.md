# ADR-0019: تدفق دفع InstaPay لحجوزات الخدمات المنزلية — فصل موافقة الشغالة عن الدفع

**الحالة:** معتمد — تنفيذ فوري، توجيه صريح من المالك (2026-08-20).

**التاريخ:** 2026-08-20

## السياق

`DomesticWorkerBookingsService.confirm()` (موافقة الشغالة على الحجز) كانت بتحصّل السعر فورًا من
محفظة العميل (`chargeCustomerInTransaction()` → `WalletsService.doubleEntry()`) في نفس لحظة
الموافقة. **بَقّة حقيقية**: مفيش أي آلية في المنصة كلها لشحن محفظة العميل (مفيش top-up عبر أي بوابة)
— يعني أي عميل بلا رصيد سابق (من استرداد/إحالة/ولاء) كان مستحيل يدفع تمامًا لأي حجز خدمة منزلية،
والشغالة كانت بتوافق على حجز مستحيل يتحصّل.

المالك حدّد التدفق الصحيح بالحرف:

> Customer creates booking → Worker accepts → Awaiting InstaPay payment → Customer transfers via
> InstaPay → Customer presses "I transferred" → Admin verifies the transfer → Booking becomes
> payment-confirmed → Service is performed → Worker earning becomes pending → Admin approves the
> worker earning.
>
> Worker acceptance must be independent from payment. The worker should be able to accept the
> booking even when the customer has no wallet balance.
>
> Please reuse and integrate the existing InstaPay manual confirmation and admin approval/rejection
> flow already built in the project rather than creating another payment system.
>
> Also handle cancellation and refunds consistently around this flow and make every stage clearly
> visible to the customer, worker, and admin.

المنصة عندها فعلاً تدفق InstaPay يدوي كامل ومختبر لطلبات `orders` (ADR-0013 §7):
`payments.controller.ts` (`pay-with-instapay`, `confirm-instapay-transfer`) و
`admin-payments.controller.ts` (`confirm-instapay`, `reject-instapay` — صلاحية `payments.confirm_manual`
مخصوصة + `@RequireStepUp()`). المطلوب إعادة استخدامه، مش تكرار منطق مواز.

## القرار

### 1. حالة حجز جديدة: `awaiting_payment`

دورة حياة `domestic_worker_bookings.status` بقت:

```
pending_confirmation ──(الشغالة توافق، بلا أي تحصيل)──▶ awaiting_payment
awaiting_payment ──(InstaPay اتأكدت إداريًا)──▶ confirmed (بالساعة) / active (شهري)
confirmed ──(completeHourly، اكتمال الزيارة)──▶ completed
active ──(نهاية فترة بلا تجديد)──▶ completed
أي حالة غير نهائية ──(إلغاء)──▶ cancelled
```

**التجديد الشهري التلقائي (`sweep`/`tryRenew`) بقى بيمرّ بنفس البوابة**: بدل الخصم الفوري الصامت من
المحفظة كل شهر (نفس بَقّة عدم وجود top-up، بس متكررة شهريًا)، فترة `active` اللي وصلت
`current_period_end_at` بتتحول لـ`awaiting_payment` (مع `pending_period_end_at` = الفترة الجايه)،
وتفضل كده لحد ما الإدارة تأكّد تحويل InstaPay جديد. ده تغيير سلوك حقيقي عن قبل (كان تجديد صامت) —
موثّق صراحة كأثر مقصود، مش أثر جانبي.

### 2. جدول `payments` بقى polymorphic: `order_id` أو `domestic_worker_booking_id`

`payments.order_id` بقى NULLABLE، وعمود جديد `payments.domestic_worker_booking_id` (NULLABLE أيضًا،
FK لـ`domestic_worker_bookings`)، مع قيد `CHECK` يفرض بالظبط واحد من الاتنين مش NULL. نفس القرار
بالظبط على `refunds` (`order_id` NULLABLE + `domestic_worker_booking_id` جديد + نفس الـCHECK).

**البديل المرفوض**: جدول `payments` منفصل لحجوزات الخدمات المنزلية. مرفوض صراحة — يخالف توجيه
المالك "reuse... rather than creating another payment system"، وبيكرر كل منطق الـidempotency
والـaudit والـwebhook-verification الموجود بالفعل بلا داعي حقيقي.

### 3. Endpoints الأدمن **بلا أي تغيير خالص**

`POST /admin/payments/:id/confirm-instapay` و `POST /admin/payments/:id/reject-instapay` بيشتغلوا
بـ`paymentId` بس أصلاً (مش `orderId`) — الأدمن بيستخدم **نفس الشاشة ونفس الـendpoint** لتأكيد/رفض
أي دفعة InstaPay، سواء لطلب أو لحجز خدمة منزلية، بلا أي فرق في الواجهة أو الصلاحية. هنا أقوى نقطة
إعادة استخدام في القرار ده كله.

`PaymentsService.confirmInstaPayPayment()`/`rejectInstaPayPayment()` بقوا بيتفرّعوا داخليًا (بعد ما
صف الـ`Payment` نفسه يتحدّث لـ`SUCCEEDED`/`FAILED` — الجزء ده عام وبلا تغيير) حسب
`lockedPayment.orderId !== null` (المسار القديم: `handlePaymentConfirmed` + توزيع الطلب) أو
`lockedPayment.domesticWorkerBookingId !== null` (مسار جديد وأبسط بكتير: قفل الحجز، تحقق إنه
`awaiting_payment`، تحويله لـ`confirmed`/`active`، بلا أي منطق توزيع — الشغالة اتحددت وقت الحجز
نفسه).

### 4. استحقاق الشغالة (`DomesticWorkerEarningApproval`) — بلا تغيير في الجدول نفسه

بالساعة: زي ما هي بالظبط، لسه بتتسجّل في `completeHourly()` بعد اكتمال الزيارة الفعلي — الشرط
الوحيد (`booking.status === CONFIRMED`) بيتحقق زي الأول بالظبط، بس دلوقتي `CONFIRMED` بيتحصّل عن
طريق تأكيد InstaPay مش خصم فوري.

شهري: كانت بتتسجّل جوّه نفس transaction الخصم القديم. دلوقتي، بما إن الخصم بقى بره
`DomesticWorkerBookingsService` تمامًا (جوّه `PaymentsService.confirmInstaPayPayment`)، الاستحقاق
بيتسجّل عبر حدث جديد `DOMESTIC_WORKER_BOOKING_PAYMENT_CONFIRMED_EVENT` بيتبعته `PaymentsService`
بعد نجاح تأكيد دفعة شهرية (بره الـtransaction، نفس فلسفة `emitPaymentConfirmedEvents`)،
و`DomesticWorkerBookingsService` بيسمعه ويسجّل صف `PENDING` — بالظبط نفس نمط
`PrepaidOrderSettlementListener` الموجود بالفعل (event-driven + sweep دوري كشبكة أمان لأي حدث
ضاع). ده الحل الوحيد اللي بيتفادى dependency دائرية بين `PaymentsService`↔`DomesticWorkerBookingsService`.

### 5. الإلغاء والاسترداد

- الحجز في `pending_confirmation`/`awaiting_payment` (لسه مفيش دفع اتأكد): إلغاء بسيط + إبطال أي
  دفعة InstaPay `PENDING` مرتبطة (`payment_status = cancelled`) — بلا أي أثر مالي حقيقي لأنه مفيش
  فلوس اتحركت أصلاً.
- الحجز `confirmed`/`active` (دفع InstaPay اتأكد فعليًا): إلغاء بيستدعي `refundCancelledDomesticWorkerBooking()`
  الجديدة في `PaymentsService` — نسخة مبسّطة من `refundCancelledPrepaidOrder()` الموجودة (نفس
  الاسم، نفس نمط الأمان بمراحله الثلاث: صف `Refund` بحالة `PROCESSING` قبل أي نداء خارجي، نداء
  `provider.refund()` نفسه بره أي transaction، تسجيل النتيجة في transaction منفصلة). استرداد كامل
  فقط (مفيش استرداد جزئي — نفس قرار v1 الموثّق أصلاً في تعليق `cancel()` القديم، دلوقتي بقى فعلي
  مش نظري).

### 6. الظهور لكل الأطراف

`domestic_worker_booking_status` بقيمته الجديدة `awaiting_payment` بيبان تلقائيًا في كل الـendpoints
الموجودة (`GET` قايمة/تفصيل الحجز للعميل والشغالة) بلا أي تعديل في شكل الاستجابة. دفعة الحجز نفسها
(مرجع InstaPay، هل العميل ضغط "حوّلت"، حالة الدفع) بتتعرض عبر نفس شكل `PaymentResponseDto` الموجود
(`order_id` بقى ممكن يكون `null`، و`domestic_worker_booking_id` جديد اتضاف للاستجابة).

## البدائل اللي اتقيّمت

- **إعادة استخدام رصيد المحفظة مع `allowNegativeBalance: true`**: مرفوض — العلم ده محجوز صراحة
  (تعليق موجود في الكود) للخصومات اللي المنصة نفسها بتبدأها (زي محفظة المنصة بترجع بالسالب عشان
  تصرف لفني)، مش لإجراء دفع بيبدأه المستخدم. هيسمح بدين وهمي بلا أي تحصيل حقيقي.
- **بناء آلية شحن محفظة (top-up) عبر Paymob**: كانت التصميم الأول قبل توجيه المالك الصريح — اتلغى
  لأنه بيبني نظام دفع مواز جديد بدل إعادة استخدام InstaPay الموجود، عكس التوجيه صراحة.
- **جدول `payments`/`refunds` منفصل لحجوزات الخدمات المنزلية**: مرفوض، نفس سبب التوجيه أعلاه.

## الأثر

Migration جديدة (`0149`)، تعديل `Payment`/`Refund`/`DomesticWorkerBooking` entities، تعديل
`PaymentsService` (تفرّع `confirmInstaPayPayment`/`rejectInstaPayPayment`، دوال جديدة لبدء/تأكيد
دفع InstaPay لحجز، `refundCancelledDomesticWorkerBooking`)، تعديل `DomesticWorkerBookingsService`
(`confirm()` بلا تحصيل، `sweep`/`tryRenew` عبر نفس بوابة `awaiting_payment`، مستمع حدث جديد لتسجيل
استحقاق شهري)، controller/DTO جديدة لعميل الحجز، وendpoints أدمن **بلا تغيير خالص**.
