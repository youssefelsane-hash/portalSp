# ADR-0013: معمارية دفع Provider-Agnostic — `PaymentProvider` + دفع قبل التوزيع + InstaPay + استرداد كامل

**الحالة:** معتمد (Phase 1 — التصميم + الأدابتر الأساسية)
**التاريخ:** 2026-08-14

## السياق

توجيه شامل من المالك (docs/08 §17، 2026-08-14، 30 بند) حدد نموذج الدفع V1 نهائيًا: كاش، كارت،
محافظ موبايل مصرية، InstaPay (اختياري مسبق الدفع بتأكيد يدوي) — **Fawry مش أولوية V1** (يفضل موجود
بس بلا وقت تطوير إضافي). المطلوب: معمارية دفع provider-agnostic حقيقية بحيث Paymob يبقى أول Adapter
بس مش المتحكم في شكل الكود، ودفع الكارت **قبل** التوزيع إجباري (مش زي دلوقتي)، واسترداد كامل
idempotent/مُدقَّق/محمي بـStep-Up.

**الوضع الحالي (اتفحص بالكامل قبل أي كود، عبر تحقيق شامل)**:
- `PaymentGateway` interface موجود بالفعل (`gateways/payment-gateway.interface.ts`) بس **ضيق جدًا**:
  `createCardPayment` + `verifyAndParseWebhook` بس — مفيش `getPaymentStatus`/`refund`/`void`/
  `capture`/`reconcile` خالص. Paymob بس بيطبّقه.
- Fawry **مش** بيطبّق `PaymentGateway` — عنده interface منفصل تمامًا (`FawryGateway`, DI token
  منفصل `FAWRY_GATEWAY`) لأن شكل رده مختلف جوهريًا (reference code مش redirect). `payments.service.ts`
  بيحقن الاتنين مباشرة (coupling صريح، مش عبر abstraction عام).
- Paymob adapter الحالي بيستخدم **الـflow القديم (Legacy Accept API v1)**: `auth/tokens` →
  `ecommerce/orders` → `acceptance/payment_keys` → iframe redirect. **مش** الـIntention API الموصى
  بيها حاليًا.
- `payments.orders.paymentStatus` (خشن، مستوى الطلب: `UNPAID/PENDING/PAID/PARTIALLY_REFUNDED/
  REFUNDED/FAILED`) و`payments.payment_status` (دقيق، مستوى المعاملة: `PENDING/PROCESSING/SUCCEEDED/
  FAILED/CANCELLED/EXPIRED/REFUNDED`) — الاتنين موجودين بالفعل ومنفصلين، بنية سليمة نبني فوقها.
- **مفيش أي بوابة دفع قبل التوزيع خالص اليوم** — `OrdersService.create()` بيحط الطلب في
  `SEARCHING_TECHNICIAN` مباشرة مع `paymentStatus=UNPAID` في نفس الـinsert، بتعليق صريح في الكود
  إن الدفع بيحصل بعد اكتمال الشغل مش قبله. `OrderStatus.PENDING_PAYMENT` موجود في الـenum
  والـstate machine بس **مستخدَمش في أي مكان خالص** — كود ميت جاهز نفعّله.
- الاسترداد الحالي: **دايمًا كامل** (`RefundType.PARTIAL` معرّف بس مش مستخدَم)، **دايمًا wallet
  credit** (مش بيكلّم بوابة الدفع الحقيقية أبدًا — فجوة موثّقة صراحة في README الموديول)،
  idempotency بس عبر فحص "موجود قبل كده" جوّه قفل الطلب (مش unique constraint حقيقي على
  `refunds`). `@RequireStepUp()` **موجود بالفعل** على `refundOrder`/`payouts approve/complete`
  (من ADR-0011، merged في `main`).
- Idempotency patterns موجودة بالفعل 3 أنماط (Pattern A: مفتاح idempotency من العميل + unique
  column؛ Pattern B: `webhook_events.external_event_id` unique + فحص قبل الحفظ؛ Pattern C: قفل
  `pessimistic_write` على الطلب + فحص حالة جوّه transaction) — هنعيد استخدامهم بالحرف، مش نخترع نمط رابع.
- **InstaPay/محافظ موبايل**: أرض بيضاء تمامًا — مفيش `PaymentMethod` value ليهم أصلاً، الموجود
  بس `PayoutMethod.INSTAPAY`/`VODAFONE_CASH` (اتجاه عكسي — فلوس بتتصرف للفني، مش بتتحصّل من العميل).

**حقول Paymob اتأكدت من التوثيق الرسمي الحالي** (Postman collections رسمية،
`github.com/PaymobAccept/API-Postman-Collections`، اتفحصت 2026-08-14 — النطاقات الرسمية
`developers.paymob.com`/`docs.paymob.com` محجوبة في بيئة التنفيذ دي، الـPostman collections هي
المصدر الرسمي البديل المتاح، مش استنتاج):

- **Create Intention**: `POST {base_url}/v1/intention/`، `Authorization: Token {secret_key}`.
  Body: `amount` (قرش)، `currency`، `payment_methods` (array — integration IDs)، `items[]`
  (`name`, `amount`, `description`, `quantity`)، `billing_data{}` (`first_name`, `last_name`,
  `phone_number`, `email`, `apartment`, `street`, `building`, `city`, `country`, `floor`, `state`)،
  `extras{}`، `special_reference` (مرجعنا الداخلي)، `notification_url`، `redirection_url`. الرد:
  `client_secret`, `intention_order_id`, `status: "intended"`, `payment_keys[]`, `confirmed: false`.
- **Unified Checkout redirect**: `GET {base_url}/unifiedcheckout/?publicKey={public_key}&clientSecret={client_secret}`
  — ده اللينك اللي العميل بيتحول عليه.
- **Retrieve Intention**: `GET {base_url}/v1/intention/element/{public_key}/{client_secret}/`.
- **Refund**: `POST {base_url}/api/acceptance/void_refund/refund`، `Authorization: Token {secret_key}`،
  body `{transaction_id, amount_cents}` — **بيدعم استرداد جزئي فعليًا** (مبلغ صريح، مش كل حاجة أو
  لا حاجة).
- **Void**: `POST {base_url}/api/acceptance/void_refund/void`، body `{transaction_id}`.
- **Capture**: `POST {base_url}/api/acceptance/capture`، body `{transaction_id, amount_cents}`.
- **Transaction Inquiry بمعاملة**: `GET {base_url}/api/acceptance/transactions/{transaction_id}`،
  `Authorization: Bearer {auth_token}` — **ملاحظة مهمة**: الـinquiry endpoint لسه بيستخدم آلية
  المصادقة القديمة (`auth_token` من `POST /api/auth/tokens` بـ`api_key`)، مش `Token {secret_key}`
  زي باقي الـendpoints الجداد — الاتنين لازم يتعايشوا جوّه الـAdapter.
- Webhook HMAC verification (الموجود بالفعل، `timingSafeEqual`، 20 حقل مرتّب) **بينطبق زي ما هو**
  على أي معاملة اتعملت عبر Intention API — عقد الـcallback نفسه، مش خاص بالـflow القديم.

## القرار

### 1. `PaymentProvider` interface جديد — بيستبدل/يوسّع `PaymentGateway` الضيق

```ts
interface PaymentProvider {
  readonly providerKey: string;           // 'paymob' | 'cash' | 'wallet' | 'instapay' | 'fawry'
  readonly isConfigured: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPaymentStatus(paymentId: string): Promise<PaymentProviderStatus>;
  refund(input: RefundInput): Promise<RefundResult>;          // جزئي مدعوم فعليًا
  void(transactionRef: string): Promise<VoidResult>;
  capture(transactionRef: string, amountCents: number): Promise<CaptureResult>;
  verifyWebhook(rawPayload: unknown, signature: unknown): WebhookVerificationResult;
  reconcile(paymentId: string): Promise<ReconcileResult>;      // استعلام مباشر لو الـwebhook متأخر/مش موثوق
}
```

`CreatePaymentResult` **discriminated union** — عشان طرق الدفع المختلفة جوهريًا (redirect، reference
يدوي، فوري) تتوحّد تحت واجهة واحدة من غير ما نجبر Cash/Wallet يتصرفوا زي Paymob:
```ts
type CreatePaymentResult =
  | { kind: 'redirect'; checkoutUrl: string; providerReference: string }   // Paymob
  | { kind: 'reference'; referenceCode: string; instructionsAr: string }   // Fawry, InstaPay
  | { kind: 'immediate'; succeeded: boolean }                               // Cash, Wallet
```

`Orders`/`notifications`/`finance` بيستهلكوا `Payment` entity الداخلي و`PaymentProviderStatus`
(enum داخلي عام)، مش بنية رد Paymob الخام أبدًا — نفس مبدأ الطلب بالحرف.

### 2. `PaymentProviderRegistry` — استبدال الحقن المباشر لكل Gateway

`payments.service.ts` بيحقن `PaymentProviderRegistry` بس (مش `PAYMENT_GATEWAY`/`FAWRY_GATEWAY`
منفصلين)، ويسأله `registry.getProvider(paymentMethod)`. كل Provider جديد = تسجيل واحد في
`payments.module.ts`، صفر تعديل في `payments.service.ts` نفسها لإضافة طريقة دفع جديدة مستقبلاً
(نص الطلب الصريح: "قابل للتوسّع من غير إعادة كتابة Orders").

### 3. Adapters

- **`PaymobProvider`** — يستبدل `PaymobGatewayService` بالكامل، Intention API (الحقول فوق بالحرف،
  صفر اختراع). `getPaymentStatus`/`reconcile` عبر Transaction Inquiry (Bearer auth_token منفصل عن
  `Token secret_key`). `refund`/`void`/`capture` عبر endpoints الرسمية فوق — **أول مرة استرداد
  حقيقي بيكلّم Paymob فعليًا** بدل wallet credit دايمًا.
- **`CashProvider`** — بلا استدعاء خارجي، `createPayment` بيرجّع `{kind:'immediate', succeeded:true}`
  فورًا (التسجيل الفعلي للتحصيل زي ما هو، `collectCash()` الموجودة). `refund` = wallet credit
  داخلي (مفيش "استرداد" حقيقي لكاش لسه ما اتحصّلش).
  Cash عمداً **مش بتاخد payment_status=paid إلكترونيًا** — الفصل بين `payment_method=cash`
  و`payment_status` محفوظ زي ما المالك طلب بالحرف.
- **`WalletProvider`** — نفس فلسفة Cash، الخصم الفعلي عبر `WalletsService.doubleEntry()` الموجودة.
- **`InstaPayProvider`** (جديد كليًا) — `createPayment` بيرجّع `{kind:'reference', referenceCode,
  instructionsAr}` (رقم/تعليمات تحويل)، `payment_status` يفضل `pending`. **مفيش webhook تلقائي —
  تأكيد يدوي بس** (تفاصيل §5 تحت). `refund`/`void`/`capture` مش مدعومين (يرمي `NotSupported`
  واضح) — الاسترداد لأي InstaPay مدفوع بيرجع wallet credit زي الكاش.
- **`FawryProvider`** — تكييف `FawryGatewayService` الموجود ليطابق نفس الـinterface (نفس منطق
  التوقيع/الـwebhook الداخلي بالحرف، غلاف بس) — **مؤجّل التطوير الفعلي، مش محذوف**. يفضل
  `isConfigured=false` افتراضيًا (نفس آلية التعطيل الذاتي الموجودة) — إعداد صريح `payments.
  fawry_enabled` (جديد، `false` افتراضيًا) يحكم ظهوره في `PaymentProviderRegistry` أصلاً، عشان
  "معطّل خلف إعداد" يكون حرفي مش بس "مفيش env vars".

### 4. دفع قبل التوزيع — كارت بس، Cash/Wallet زي ما هما

`OrderStatus.PENDING_PAYMENT` (موجود، ميت) بيتفعّل أخيرًا:
- `OrdersService.create()` لو `payment_method ∈ {card, instapay}`: الطلب يتعمل بحالة
  `PENDING_PAYMENT` (مش `SEARCHING_TECHNICIAN`)، `paymentStatus=PENDING`. **التوزيع ميتفعّلش**
  (`ORDER_CREATED_EVENT` ميتصدّرش لحد الدفع يتأكد — `OrderDispatchListener` بيسمعه هو اللي بيبدأ
  المطابقة، فتأجيل التصدير = تأجيل التوزيع، صفر تعديل في `matching.service.ts`).
- Webhook/تأكيد ناجح على طلب `PENDING_PAYMENT` → `paymentStatus=PAID`، `orderStatus` ينتقل لـ
  `SEARCHING_TECHNICIAN`، **وقتها بس** `ORDER_CREATED_EVENT` بيتصدّر → التوزيع يبدأ. هذا **فرع
  جديد** في `finalizeGatewayWebhook()`/معادلها الجديد، متمايز عن السلوك الحالي (`settleAndComplete()`
  بتقفل الطلب `COMPLETED` — ده لسه بيحصل بس لدفعات بعد اكتمال الشغل، مش قبله).
- Cash/Wallet: **صفر تغيير** — يفضلوا `SEARCHING_TECHNICIAN` فورًا زي دلوقتي بالظبط.

### 5. تأكيد InstaPay يدوي — صلاحية Finance مخصوصة + idempotent + مُدقَّق بالكامل

صلاحية جديدة `payments.confirm_manual` (migration)، endpoint جديد
`POST /admin/payments/:id/confirm-instapay` — `@RequirePermission('payments.confirm_manual')`.
Idempotency: نفس نمط Pattern C (قفل `pessimistic_write` على صف `payments`، فحص `paymentStatus===
PENDING` جوّه القفل قبل التحديث — نقر مزدوج/إعادة إرسال بيرجع نفس النتيجة بلا أثر مالي مكرر).
Audit كامل: الموظف، الوقت، المبلغ، معرّف الطلب/الدفعة، المرجع، الحالة قبل/بعد — نفس نمط
`audit_logs` الموجود بالحرف. بعد التأكيد: نفس فرع "الدفع اتأكد" في §4 (لو الطلب لسه
`PENDING_PAYMENT`، التوزيع يبدأ).

### 6. شغل إضافي بعد الدفع — دفعة منفصلة، مش تعديل الأصلية

`OrderItemsService.approve()` الحالية بتضيف للـ`total_amount_cents` وتسيب التحصيل لآخر الشغل —
**سلوك صحيح لسه لـCash/Wallet** (لسه بيتحصّلوا مرة واحدة في الآخر). **للطلبات اللي دفعت إلكترونيًا
مقدمًا (كارت/InstaPay)**: `approve()` بيتفرّع — لو فيه `Payment` ناجح سابق لنفس الطلب، البند
الإضافي بيولّد `Payment` **جديد ومنفصل** (مش تعديل القديم) بمبلغ الفرق بس، الطلب يفضل
`AWAITING_QUOTE_APPROVAL` (مش `IN_PROGRESS`) لحد الدفعة الجديدة دي تتأكد. السجل المالي بيحتفظ
بالدفعتين منفصلتين تمامًا (`payments` جدول، صف لكل دفعة، مرتبطين بنفس `order_id`) — **صفر إعادة
كتابة لمعاملة واحدة مصطنعة**، مطابق تمامًا لمثال المالك (10,000 + 2,000 = 12,000 محفوظين منفصلين).

### 7. الاسترداد — استرداد جزئي حقيقي + استدعاء بوابة حقيقي

`RefundOrderDto` يكسب `amount_cents?` اختياري (غياب = استرداد كامل، القيمة الافتراضية الحالية).
`refundOrder()` بيستخدم `registry.getProvider(payment.method).refund({transactionRef, amountCents})`
بدل الافتراض الدائم لـwallet credit — لو الـProvider بيدعم استرداد حقيقي (Paymob، عبر endpoint
فوق)، الفلوس ترجع لمصدرها الفعلي؛ لو مش مدعوم (Cash/InstaPay/Wallet)، fallback لـwallet credit
الموجود (**سلوك موثّق صراحة كـfallback**، مش صدفة). `RefundStatus` بيتفعّل فعليًا (مش دايمًا
`COMPLETED` فورًا) — `PENDING` لحد ما رد الـProvider يرجع، `PROCESSING`/`COMPLETED`/`REJECTED`
حسب الرد الفعلي. Idempotency بترقّى من "فحص جوّه قفل الطلب" لـ**unique constraint حقيقي**
(`refunds.payment_id` partial unique index، migration) — دفاع مزدوج (قفل + قيد DB) بدل قفل واحد بس.

### 8. `AWAITING_PAYMENT` — القرار المعماري النهائي

**مش هيتفعّل كحالة order منفصلة إضافية**. `payment_status=pending` + حراسة التوزيع
(`PENDING_PAYMENT` order status، §4 فوق) كافيين تمامًا للتعبير عن "الدفع مطلوب قبل التوزيع" —
إضافة `AWAITING_PAYMENT` كمان كانت هتبقى enum قيمة تكرر نفس المعنى بلا داعي حقيقي (نفس تحذير
المالك الصريح: "متجبرش كل طلب إلكتروني يعدّي بحالة جديدة لمجرد وجود الـenum"). `AWAITING_PAYMENT`
يفضل زي ما هو تمامًا لدورها الحالية (بعد اكتمال الشغل، دفع بعدي).

## البدائل اللي اتقيّمت

- **توحيد Fawry/InstaPay جوّه نفس شكل رد Paymob (redirect) بالقوة**: رُفض — الاتنين reference-code
  مش redirect فعليًا، إجبار الشكل ده كان هيبقى كذب معماري. الحل: `CreatePaymentResult` discriminated
  union بدل شكل واحد مُجبَر.
- **`AWAITING_PAYMENT` order status منفصلة قبل التوزيع**: رُفضت — `PENDING_PAYMENT` (موجودة بالفعل
  في الـenum والـstate machine) بتغطي بالظبط نفس المعنى، صفر داعي لقيمة تانية.
- **استرداد Paymob دايمًا webhook-driven (مش استعلام مباشر)**: رُفض جزئيًا — `reconcile()` مطلوب
  صراحة من المالك للحالات اللي الـwebhook فيها متأخر/مش موثوق، فالـAdapter بيدعم الاتنين
  (webhook push + inquiry pull) مش يعتمد على واحد بس.
- **مفتاح idempotency تلقائي مولّد من السيرفر لدفعة InstaPay اليدوية**: رُفض — التأكيد فعل إداري
  (موظف بيضغط زرار)، مفتاح العميل مش موجود أصلاً هنا؛ الحماية عبر قفل + فحص حالة (Pattern C)
  بدل مفتاح idempotency من العميل (Pattern A، غير منطبق هنا).

## الأثر

- Migration جديدة: `payments.confirm_manual` permission، `refunds.payment_id` partial unique
  index، `RefundOrderDto.amount_cents` (تعديل DTO مش schema)، إعداد `payments.fawry_enabled`.
- `gateways/payment-gateway.interface.ts` يتوسّع لـ`PaymentProvider` (الاسم بيتغيّر، breaking
  internal — كل المستهلكين جوّه الموديول بس، مفيش استهلاك خارجي).
- `PaymobGatewayService` يُعاد كتابته بالكامل لـIntention API — تغيير معماري حقيقي، مش تعديل صغير.
- `FawryGatewayService` يتكيّف لنفس الـinterface (غلاف، منطق داخلي زي ما هو).
- Adapters جداد: `CashProvider`, `WalletProvider`, `InstaPayProvider` (تغليف منطق موجود بالفعل
  جوّه الشكل العام الجديد).
- `payments.service.ts` يتغيّر جوهريًا — الحقن المباشر لـ2 gateway بيتشال لصالح
  `PaymentProviderRegistry`. `OrdersService.create()` تتغيّر (فرع `PENDING_PAYMENT` جديد لكارت/
  InstaPay). `OrderItemsService.approve()` تتغيّر (فرع دفعة إضافية منفصلة). `webhooks.controller.ts`
  يتوسّع (منطق "الدفع ده قبل التوزيع ولا بعد الشغل" جديد).
- **نطاق Phase 1 (هذا الـADR)**: الـabstraction + Paymob Intention + Cash/Wallet adapters + دفع
  قبل التوزيع للكارت + استرداد حقيقي جزئي عبر Paymob + InstaPay تأكيد يدوي + دفعة شغل إضافي منفصلة.
  **مؤجّل صراحة**: milestone payments للشغل الكبير (موثّق كقدرة مستقبلية بس، بلا قواعد الآن)،
  تفعيل Fawry الفعلي (يفضل معطّل خلف `payments.fawry_enabled=false`)، محافظ موبايل حقيقية غير
  Paymob's `payment_methods` array (تُغطّى فعليًا عبر نفس Paymob Intention لو المزوّد بيدعمها —
  مفيش Adapter منفصل مطلوب إلا لو مزوّد تاني اتضاف مستقبلاً).
