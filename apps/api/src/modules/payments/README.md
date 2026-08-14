# modules/payments

بوابات الدفع (Paymob/Fawry)، المحفظة، الـ webhooks. جداول: payments, wallets, wallet_transactions, webhook_events (قاموس §7.1-7.3, §11.3). Idempotency-Key إجباري.

**الحالة: شغال (S7) — كاش، محفظة، دفع بالبطاقة (Paymob)، صرف الفنيين، والاسترجاع. تكامل Paymob جاهز 100% معمارياً ومُختبر حياً بتوقيع HMAC حقيقي، محتاج بس حساب Paymob فعلي عشان يتفعّل — `isConfigured=false` بيرفض بوضوح من غيره (تفاصيل تحت + `docs/03-external-integrations.md`).**

- **`WalletsService`**: محرك الدفتر المزدوج. `doubleEntry()` بياخد `EntityManager` اختياري عشان يشارك في transaction الطالب (لازم، وإلا القيد المالي وتحديث الطلب يبقوا عمليتين منفصلتين مش ذرّيتين مع بعض). بيقفل المحفظتين بترتيب ثابت (بالـ id) عشان يمنع deadlock لو حصل تحويلين متزامنين بالعكس. `reserveForPayout`/`releaseReservation`/`finalizePayout` بيديروا حجز رصيد الصرف بنفس انضباط القفل.
- **حساب المنصة**: صف `users` ثابت (`infra/migrations/0019`) بمحفظة `owner_type=platform` — كل تحويل فلوس في النظام بيعدي منها (دفع العميل، أرباح الفني، الاسترجاع، الصرف) عشان الدفتر يفضل متوازن ومراقب من نقطة واحدة.
- **`POST /technician/orders/:id/collect-cash`**: الفني بيأكّد استلام الكاش، الطلب بيتقفل `completed`، وعمولة المنصة/أرباح الفني بتتسوّى فوراً — حتى لو الكاش فعلياً في جيب الفني، ده تسوية محاسبية داخلية (موثّقة كتعليق في الكود).
- **عمولة معدّلة بمستوى الفني**: `computeSettlement()` بقى بيضيف `technician_level_config.commission_adjustment_percentage` (من `../technicians/README.md`) على عمولة الخدمة الأساسية قبل ما يحسب — مستوى أعلى = عمولة منصة أقل. اتعمله اختبار فعلي: نفس الطلب طبّق 18% مع فني `professional` وبعدين 15% بالظبط بعد ما الأدمن غيّر إعدادات المستوى عبر الـ API من غير أي restart.
- **عمولة إضافية حسب `booking_mode` — صُنّاع (`docs/06` §2.1، `docs/07` الجزء ب)**: `computeSettlement()` بقى بيضيف كمان `commission.{individual|team|emergency}_adjustment_percentage` (إعدادات جديدة، migration `0052`, نفس نمط `settingsService.getNumber()` المستخدم لنقاط الولاء فوق) فوق عمولة الخدمة + فرق مستوى الفني، قبل الـ clamp النهائي (0-100%). القيم الافتراضية: `individual`/`team`=0 (بلا تأثير)، `emergency`=5 (تجريبية، قابلة للتعديل الكامل من `/admin/settings` — **مش** رقم نهائي مخترع، فجوة موثّقة #3 في `docs/07` اتحلّت بنفس فلسفة نقاط الولاء بالضبط). **اتعمله اختبار حي كامل**: طلب `booking_mode=emergency` (خدمة عمولتها الأساسية 15%، فني `premium` بفرق مستوى -3%) طبّق `17%` بالظبط (15 - 3 + 5)؛ الأدمن غيّر `commission.emergency_adjustment_percentage` لـ`10` عبر `/admin/settings` من غير أي restart، وطلب طوارئ تاني لنفس الفني طبّق `22%` بالظبط (15 - 3 + 10) — إثبات إن الإعداد ديناميكي فعلاً مش مجمّد وقت الإقلاع.
- **كسب نقاط ولاء تلقائي عند اكتمال أي طلب مدفوع — كانت فجوة موثّقة صراحة في `../promotions/README.md` ("معدل الكسب مالوش رقم، مش هنخترعه")، اتقفلت**: `settleAndComplete()` بقى بينادي `LoyaltyService.earn()` (حقن جديد من `PromotionsModule`، اتصدّرت `LoyaltyService` منها لأول مرة) بعد قيد تحويل أرباح الفني مباشرة، بمعدل `loyalty.earn_points_per_100_egp_spent` القابل للتعديل من `/settings` (`SettingsService.getNumber()`, migration `0043_loyalty_settings.sql`). `LoyaltyService.earn()` اتعدّلت تقبل `EntityManager` اختياري (نفس نمط `WalletsService.doubleEntry`) عشان الكسب يحصل جوّه **نفس** transaction التسوية — لو فشل، كل التسوية بترجع، مش "الطلب اتقفل بس النقاط لأ". **اتعمله اختبار حي كامل**: طلب حقيقي 300ج اكتمل بكاش، رصيد النقاط بقى `3` بالظبط (300÷100×1)؛ الأدمن غيّر المعدل لـ`3` عبر `/settings` من غير أي restart؛ طلب تاني بنفس القيمة اكتمل، الرصيد بقى `12` بالظبط (3 + 300÷100×3=9) — إثبات إن الإعداد ديناميكي فعلاً مش مجمّد وقت الإقلاع. `loyalty_transactions` سجّلت `source=order`, `reference_id=<order_id>` لكل عملية.
- **`POST /orders/:id/pay-with-wallet`**: يتطلب `Idempotency-Key` header إجباري — تكرار نفس المفتاح يرجّع نفس النتيجة من غير ما يخصم تاني.
- **`POST /admin/orders/:id/refund`**: بيعكس أرباح الفني (لو اتسوّت)، وبيرجّع فلوس العميل لمحفظته دايماً — لأي طريقة دفع أصلية (محفظة/كاش/كارت/فوري على حد سواء، تفاصيل الإصلاح تحت).
- **`POST /technician/payouts`** + **`POST /admin/payouts/:id/approve|reject|complete`**: حد أدنى للصرف، موافقة تلقائية تحت سقف معين وموافقة يدوية فوقه (§11.2 في القاموس)، ورصيد بيتحجز (`reserved_balance_cents`) لحظة الطلب مش لحظة التنفيذ — فمينفعش نفس الرصيد يتصرف مرتين. لو الصرف مش auto-approved بيصدر حدث `payout.requires_review` — `notifications` بيوجّهه لدور `finance` عبر `notification_routing_rules` (تفاصيل في `../notifications/README.md`).
- **`GET /admin/wallets/:userId` — جديد، طلب صريح ("الأدمن عنده access إنه يخش يشوف المحفظة عشان يشوف هل في مشكلة أو لأ")**: قراءة بس، مفتوح لأي أدمن (نفس نمط `GET /admin/customers/:userId`/`GET /admin/technicians/:id` — `RolesGuard` كفاية، مفيش `@RequirePermission`). بيرجّع الرصيد + آخر الحركات (`AdminWalletController`, `WalletsService.findByUserIdOrThrow`/`listTransactionsForUser` الموجودين من زمان، مفيش منطق جديد في الـ service نفسها). معروض في `apps/admin` جوّه صفحتي `/customers/:userId` و`/technicians/:id` (كارت "المحفظة" جديد، `technicians/:id` بيحل `user_id` من تفاصيل الفني الأول قبل ما ينادي endpoint المحفظة). **اتعمله اختبار حي كامل**: محفظة عميل حقيقي فيها حركات قديمة (استرجاع/رسوم إلغاء/دفع) ظهرت بالظبط بالمبلغ والاتجاه الصح، أدمن بدون صلاحية اترفض `403` (RolesGuard بس)، UUID مالوش محفظة رجع `404` واضح، والشاشتين اتأكدوا بصرياً عبر Playwright.
- **`GET /admin/payouts?status=` — كانت فجوة موثّقة صراحة، اتقفلت**: `approve`/`reject`/`complete` فوق كانوا موجودين من زمان بس مفيش endpoint يرجّع قايمة طلبات الصرف أصلاً — عملياً مستحيل الاستخدام من غير معرفة الـ`id` مقدماً. `PayoutsService.listForAdmin()` (جديدة) بترجّع الصفوف مع بيانات الفني (كود + اسم، جوينز يدوي بس على `technician_profiles`/`users` بدل query builder معقّد — القايمة مش متوقع يكون فيها آلاف الصفوف). اتكشفت الفجوة دي بنفس أسلوب اكتشاف فجوة `apps/admin` الأعم (مقارنة كل `/admin/*` controller بصفحات `apps/admin/src/app` الموجودة فعلاً — تفاصيل الشاشة الجديدة في `apps/admin/README.md`).
- **اتعمله اختبار end-to-end فعلي شامل جداً** (مش سيناريو واحد سعيد): دورة كاش كاملة مع تسوية عمولة صحيحة 100% رياضياً، رفض دفع مكرر على طلب مدفوع، استرجاع كامل بعكس صحيح لكل القيود (تحقّق إن مجموع كل المحافظ = صفر بعد كل عملية)، رفض دفع بمحفظة رصيدها صفر، تأكيد الـ idempotency (نفس المفتاح = نفس النتيجة)، رفض صرف تحت الحد الأدنى وفوق الرصيد الفعلي، رفض صرف من غير صلاحية أدمن، إرجاع الحجز عند الرفض، رفض إغلاق صرف مرتين، **و3 طلبات صرف متزامنة فعلياً (parallel processes) على رصيد يكفي واحد بس — واحد نجح والباقي اترفضوا بأمان، صفر تعارض**.
- **ملاحظة أمان صريحة**: `REVOKE UPDATE, DELETE ON wallet_transactions` في `infra/migrations/0008` بيمنع التعديل/الحذف بس لو الـ DB role اللي التطبيق بيتصل بيه *مختلف* عن اللي عمل الـ migrations (مالك الجدول بيتجاوز REVOKE FROM PUBLIC تلقائياً في Postgres). في الإعداد الحالي (role واحد لكل حاجة) القيد ده تنظيمي بس، مش مضمون DB-level حقيقي — فصل الـ roles ده مهمة تقوية إنتاج (production hardening) لسه ما اتعملتش.
- **بَقّة مالية حقيقية خطيرة اتلقطت واتصلحت وقت اختبار حي (`customer-app` wallet payment flow)**: `settleAndComplete()` كان بيستخدم `order.technicianId!` (non-null assertion) قبل ما ينادي `findByProfileIdOrThrow()` — لو الطلب وصل للتسوية بـ`technician_id = NULL` فعلياً، TypeORM بيتصرف بطريقة خطيرة: `Repository.findOne({where:{id: null}})` **مش بيرجع صف فاضي**، بيسقط الشرط بالكامل ويرجّع صف عشوائي (أول صف يوصله بترتيب فحص الفهرس، مش بالضرورة الأقدم إنشاءً) بدل "مفيش نتيجة". النتيجة العملية: عمولة الفني اترحّلت فعلياً من محفظة المنصة لمحفظة **فني عشوائي غير مرتبط بالطلب خالص**، من غير أي خطأ أو تحذير — تحويل فلوس حقيقي لشخص غلط بصمت تام. اتأكدت البَقّة حياً بإعادة إنتاجها مرتين (طلب تجريبي بـ`technician_id` فاضي عبر SQL مباشر، ثم دفع فعلي من محفظة عميل) — فني عشوائي استلم فعلاً 24000 قرش و4000 قرش في محاولتين منفصلتين، اتأكد بـ`psql` مباشر. **السبب الجذري إن السيناريو ده مش قابل للوصول فعلياً عبر مسارات التطبيق الحقيقية** (`accept()`/`reassign()` بيحطوا `technician_id` دايماً قبل أي حالة قابلة للدفع، `order-state-machine.ts` بيضمن كده) — اتكشفت بس لأن اختبار حي احتاج طلب تجريبي بحالة `work_completed` جاهزة من غير ما يعدّي دورة الفني الكاملة، فاستُخدم `INSERT` مباشر ناسي `technician_id`. **الإصلاح مش مجرد تصحيح سيناريو اختبار — تقوية دفاعية حقيقية للكود نفسه**: (1) `settleAndComplete()` بقى بيتحقق `if (technicianEarningCents > 0 && order.technicianId)` قبل أي تحويل — بالظبط نفس النمط الصحيح المستخدم أصلاً في `computeSettlement()` (سطر 49) وفي مسار عكس الاسترجاع (سطر 348) في نفس الملف، مجرد إن مسار التسوية الأساسي كان الوحيد الناقص للحماية دي. (2) `TechniciansService.findByProfileIdOrThrow()` و`CustomerProfilesService.findByProfileIdOrThrow()` الاتنين بقوا بيرفضوا فوراً (`404`) لو اتنادوا بـ`null`/`undefined` **قبل** ما يوصلوا لـ TypeORM أصلاً — حماية دفاعية عامة تمنع نفس الفخ في أي مكان تاني يستخدم نفس الدالة، مش بس في المسار اللي اتلقطت فيه. اتأكد الإصلاح حياً: نفس السيناريو (طلب `work_completed` بـ`technician_id` فاضي) اتدفع بنجاح من غير أي تحويل خاطئ (`wallet_transactions` صفر صف لهذا الطلب، رصيد الفني العشوائي فضل زي ما هو). كل الأرصدة المتأثرة اترجعت لحالتها الأصلية يدوياً بعد التأكد من الإصلاح.
- **بَقّة مالية حقيقية اتلقطت واتصلحت (مراجعة booking flow الشاملة 2026-08-12) — استرجاع الكارت/فوري كان بيتسجّل "مكتمل" من غير أي حركة فلوس فعلية**: `PaymentGateway.interface.ts` معندهوش دالة `refund()` خالص (مش المرحلة دي) — `refundOrder()` كان بيسجّل `refund_method=original_method` و`refund_status=completed` لمدفوعات الكارت/فوري، بس بلوك تحويل الفلوس فعليًا (`doubleEntry` لمحفظة العميل) كان مقيّد بـ`if (paymentMethod === WALLET || paymentMethod === CASH)` بس — يعني العميل يشوف "الاسترجاع اتم" في النظام بس فلوسه ما ترجعش لا لكارته ولا لمحفظته خالص، بصمت تام. الإصلاح: كل طرق الدفع بترجع فلوس حقيقية لمحفظة العميل دلوقتي (نفس آلية الكاش بالظبط — ممولة محاسبيًا من عكس أرباح الفني اللي بيحصل لكل الطرق زي بعض وقت التسوية أصلاً)، و`refund_method` بقى دايماً `wallet_credit` (بيعكس الحقيقة، مش `original_method` كاذبة). **اتعمله اختبار حي كامل**: طلب حقيقي مدفوع (400ج) اتحقن بمحاكاة دفع كارت ناجح (مفيش حساب Paymob حقيقي هنا، نفس قيد بقية اختبارات Paymob في الملف ده)، `POST /admin/orders/:id/refund` نفّذ فعليًا عبر الـendpoint الحقيقي — رصيد محفظة العميل اتحرّك من `0` لـ`40000` قرش بالظبط (طابق مبلغ الطلب تمامًا)، و`refund_method` سجّل `wallet_credit` صح.
### بوابة الدفع بالبطاقة (Paymob) — كانت فجوة موثّقة ("محتاجة إنترنت خارجي")، اتقفلت معمارياً

مفيش إنترنت خارجي في بيئة التطوير دي (لسه)، فمينفعش نتأكد من التكامل ضد Paymob الحقيقي — لكن
التكامل نفسه مبني بالكامل وجاهز 100%، ومحتاج بس حساب Paymob حقيقي (تفاصيل كاملة في
`docs/03-external-integrations.md`) عشان يشتغل فعلياً من غير أي تعديل كود إضافي.

- **`gateways/payment-gateway.interface.ts`**: واجهة قابلة للتبديل، نفس فلسفة `StorageService`/`NotificationDispatcher` بالحرف — `createCardPayment()` (تسجيل عملية + رابط iframe) و`verifyAndParseWebhook()` (تحقق توقيع + فك تشفير حمولة، مزامن تماماً، مفيش I/O).
- **`gateways/paymob-gateway.service.ts`**: تطبيق حقيقي مطابق لعقد Paymob Accept API v1 — مصادقة (`/api/auth/tokens`) → تسجيل طلب (`/api/ecommerce/orders`، `merchant_order_id` = `payments.id` عندنا، ده اللي بيربط رد الـ webhook بالدفعة الصح) → طلب مفتاح دفع (`/api/acceptance/payment_keys`) → رابط iframe مستضاف. `isConfigured` بيبقى `false` تلقائياً لو أي env var من الأربعة ناقص (`PAYMOB_API_KEY`/`PAYMOB_INTEGRATION_ID_CARD`/`PAYMOB_IFRAME_ID`/`PAYMOB_HMAC_SECRET`) — الدفع بالبطاقة بيرفض بوضوح (`PAY_001`, 503) بدل ما ينهار أو يتظاهر بالنجاح، والكاش/المحفظة يفضلوا شغالين عادي.
- **HMAC-SHA512 مطابق حرفياً لتوثيق Paymob الرسمي** (`computeHmac()` جوّه `paymob-gateway.service.ts`) — concatenation بترتيب ثابت لـ20 حقل من كائن الـ transaction، `timingSafeEqual` للمقارنة (مش `==` عادية، عشان مايسربش معلومة توقيت). **7 اختبارات وحدة حقيقية** (`paymob-gateway.service.spec.ts`) بتتأكد: توقيع صحيح يتقبل ويستخرج كل الحقول صح، توقيع غلط/متلاعب فيه (حتى تغيير حقل واحد زي `amount_cents` بعد حساب التوقيع) يترفض، secret غلط يترفض، بوابة مش مُعدّة ترفض فوراً من غير أي نداء شبكة.
- **`POST /orders/:id/pay-with-card`**: نفس نمط `pay-with-wallet` بالظبط — `Idempotency-Key` إجباري. بيسجّل `payments` بحالة `pending` **بعد** التأكد إن البوابة مُعدّة (مش قبل — لو مُعدّة بس نداء الشبكة فشل، نفس صف الدفعة بيتحدّث لـ`failed` وبيتقبل retry بنفس المفتاح على **نفس الصف** بدل ما يتكرر `payment_number` لكل محاولة)، وبيرجّع `redirect_url` للكلاينت يفتحه في WebView. **مفيش أي تسوية بتحصل هنا خالص** — القفل النهائي بس لما البوابة تأكّد عبر الـ webhook.
- **`POST /webhooks/paymob`** (`@Public()`، الأمان بالكامل عبر HMAC مش JWT): بيسجّل كل حدث في `webhook_events` (الجدول ده موجود في الشيما من `0011_system.sql` بس مفيش أي كود كان بيستخدمه لحد دلوقتي — أول استهلاك حقيقي ليه هنا) مع `external_event_id UNIQUE` بيمنع معالجة نفس الحدث مرتين (بوابات الدفع بتعيد إرسال الـ webhook لو مستحملتش رد سريع بما فيه الكفاية — شائع جداً). لو التوقيع صح والدفع نجح، بيعدّي بنفس `settleAndComplete()` اللي `collectCash`/`payWithWallet` بيستخدموه — نقطة تسوية واحدة للنظام كله، الدفع بالبطاقة مش استثناء. بيرجع `200` دايماً (حتى لو الحدث اترفض/اتجاهل) عشان مايخليش البوابة تعيد إرسال حدث احنا فعلاً قررنا فيه بوعي.
- **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي (باستخدام env vars مؤقتة وwebhook مُوقّع يدوياً بنفس خوارزمية Paymob)**: أول نسخة من `finalizeGatewayWebhook` كانت بتبعت `payment.customerId` (ده `customer_profiles.id`) مباشرة كـ`changedByUserId` لـ`settleAndComplete()` (اللي محتاج `users.id` فعلياً — FK على `order_status_history.changed_by_user_id`) — نفس فخ الـ id المختلط اللي اتوثّق قبل كده في نفس الملف (راجع "بَقّة مالية حقيقية خطيرة" تحت)، بس هنا كان بيفشل بوضوح (FK violation) بدل ما يحوّل فلوس لحد غلط، لأن `customer_profiles.id` مش موجود أصلاً في جدول `users`. اتصلح بإضافة `customerProfiles.findByProfileIdOrThrow(payment.customerId)` قبل نداء `settleAndComplete` واستخدام `customerProfile.userId` الصح. اتأكد الإصلاح حياً: طلب حقيقي دفع بالبطاقة (صف `pending` اتحقن يدوياً بمحاكاة تسجيل ناجح عند البوابة، لأن مفيش إنترنت خارجي هنا لنداء Paymob الحقيقي) → webhook موقّع صح بـ`success=true` → الطلب اتقفل `completed`/`paid`، العمولة اتحسبت صح (30000 = 4500 منصة + 25500 فني)، وقيد `wallet_transactions` مزدوج ظهر صح. إعادة إرسال **نفس** الـ webhook (retry شائع من كل البوابات) اتجاهلت تماماً — صفر تكرار في `webhook_events` أو `wallet_transactions`. توقيع بمقارنة حروف كبيرة/صغيرة غلط (`True`/`False` بدل `true`/`false`) اترفض بوضوح، يثبت إن التحقق فعلاً حساس لتنسيق القيم مش شكلي بس.
- **بَقّة أمنية/مالية حقيقية اتلقطت واتصلحت (مراجعة أمان شاملة 2026-08-13، P0-7)**: `finalizeGatewayWebhook`
  كانت بتثق في `succeeded=true` من البوابة وتسوّي الطلب بالكامل من غير أي مقارنة بين المبلغ اللي
  وصل فعلاً (`amount_cents` من حمولة الـwebhook نفسها) والمبلغ المتوقع (`payment.amountCents`
  المسجّل وقت إنشاء الدفعة). توقيع HMAC بيمنع مهاجم عشوائي من تزوير حدث، لكن مبيحميش من خطأ
  إعداد/تكامل حقيقي في البوابة (partial payment، عملة مختلفة، bug عند البوابة) يسوّي طلب بمبلغ
  أقل من قيمته الحقيقية. الإصلاح: `WebhooksController` بقى يمرّر `amountCents` (كانت موجودة أصلاً
  في `WebhookVerificationResult`/`FawryWebhookVerificationResult`، بس متبعتش قبل كده) لـ
  `finalizeGatewayWebhook`، واللي بترفض الحدث بوضوح (`webhook_events.processing_status=failed`)
  لو مش مطابق تمامًا — طبقة حماية مستقلة عن HMAC عمدًا، مش بديل عنه. اختبار regression حي في
  `webhook-amount-verification.spec.ts`: مبلغ أقل من المتوقع بيترفض بأمان (الدفعة تفضل `pending`،
  مفيش تسوية)، مبلغ مطابق بيعدّي الفحص عادي (يكمل لمسار التسوية الطبيعي).
- **بَقّة تشغيلية حقيقية اتلقطت واتصلحت (نفس المراجعة، P0-8)**: `WebhooksController` كان بيرجع
  `200` **دايمًا** حتى لو `finalizeGatewayWebhook` رمى استثناء داخلي غير متوقّع (DB/Redis واقع
  وقت المعالجة) — يعني لو Paymob/Fawry بعتوا نجاح والداتابيز وقعت لحظتها، كنا بنكذب على البوابة
  إن الحدث "اتستلم" فمتحاولش تاني، بينما الدفعة الحقيقية فضلت غير متسوّاة. الإصلاح: الكنترولر بقى
  بيفرّق بين مرحلتين — `verifyAndParseWebhook()` لو رمت (حمولة غير قابلة للتحليل خالص) لسه بترجع
  `200` (تجاهل واعي، إعادة إرسال نفس الحمولة الغلط مش هتصلح حاجة)، لكن أي throw من
  `finalizeGatewayWebhook()` نفسها (اللي مبقتش ترمي إلا لأخطاء داخلية غير متوقّعة بعد إصلاح P0-7 —
  كل قرار واعي زي توقيع غلط/مبلغ مش مطابق بيرجع عادي بلا استثناء) بقى بيتسيب يتصاعد لـNest فيرجّع
  `5xx` حقيقي، فالبوابة تعيد المحاولة تلقائيًا (سلوكها القياسي). اختبار وحدة في
  `webhooks.controller.spec.ts` بيثبت الفرق: حمولة غير صالحة → `200`، `finalizeGatewayWebhook`
  بترمي → الكنترولر يسيب الخطأ يتصاعد (مش بيبتلعه)، قرار واعي عادي → `200` زي المتوقع.
  **فجوة متبقية موثّقة صراحة عمدًا (مش P0، خارج نطاق هذا الإصلاح)**: فحص "الحدث اتعالج قبل كده"
  في `finalizeGatewayWebhook()` بيعتبر أي صف `webhook_events` موجود (بما فيه `FAILED` بسبب خطأ
  داخلي عابر) "اتعالج"، فحتى لو البوابة أعادت نفس الحدث بعد الـ`5xx`، إعادة المحاولة دي مش هتؤدي
  فعليًا لمحاولة تسوية تانية. حل كامل (تمييز "قرار واعي نهائي" عن "فشل عابر قابل لإعادة المحاولة"
  في نموذج بيانات `webhook_events` نفسه) نطاق أوسع من P0-8 المطلوب، مؤجّل عمدًا.
- ~~لسه من غير: بوابة Fawry~~ — **اتقفلت جزئياً**: `FawryGatewayService` (كود مرجعي "ادفع في أقرب فوري"، `payment_method=fawry_reference` — `infra/migrations/0042_fawry_payment_method.sql`) اتبنى كـ provider منفصل تماماً جنب `PAYMENT_GATEWAY` (Paymob) بدون ما يلمس أي كود موجود، بالظبط زي ما كان متوقّع. تفاصيل معمارية كاملة (بما فيها الفرق الجوهري عن Paymob: مفيش redirect_url/iframe خالص، رد كود مرجعي يتدفع كاش في منفذ فوري) تحت في قسم مخصوص. **⚠️ تحذير صريح**: توقيع الطلبات/الـ webhook (`computeChargeSignature`/`computeWebhookSignature` في `gateways/fawry-gateway.service.ts`) مبني على أفضل فهم موثّق للعقد الرسمي، **لسه محتاج تحقق مباشر ضد sandbox FawryPay حقيقي قبل أي استخدام إنتاجي بفلوس حقيقية** — تفاصيل كاملة في `docs/03-external-integrations.md` § FawryPay.
- ~~لسه من غير: `payout_order_items`~~ — **اتقفلت**، تفاصيل كاملة في `../payouts/README.md`.
- لسه من غير: اشتراكات (S7 في الماستر بلان الأصلي بيقصد بيه اشتراكات أطول). تفاصيل الحصول على حساب Paymob/FawryPay حقيقي ومكان كل قيمة: `docs/03-external-integrations.md`.

## بوابة تانية جنب Paymob — FawryPay (كود مرجعي "ادفع في أقرب فوري")

`payments.payment_gateway` كان معلّق عليه `-- paymob | fawry | manual` من أول يوم (`0008_finance.sql`) — الجدول والـ schema كانوا جاهزين لبوابة تانية من البداية، بس مفيش كود كان بيستخدم القيمة دي. `POST /orders/:id/pay-with-fawry-reference` (نفس نمط `pay-with-card` بالظبط: `Idempotency-Key` إجباري، retry idempotent بنفس صف الدفعة، مفيش تسوية هنا خالص) بيرجّع `reference_number`/`expires_at` بدل `redirect_url` — العميل بياخد الكود ويدفعه كاش فعلي في أي منفذ فوري، والتأكيد بييجي عبر `POST /webhooks/fawry` (توقيع في الـ body نفسه `signature`، مش query param زي Paymob's `hmac`) بنفس مسار `finalizeGatewayWebhook`/`settleAndComplete` اللي كل طرق الدفع التانية بتستخدمه — نقطة تسوية واحدة للنظام كله، مفيش استثناء. `finalizeGatewayWebhook` اتعمله تعميم بسيط (باراميتر `paymentMethod` اختياري، افتراضي `CARD` للتوافق مع نداء Paymob القديم) عشان يقدر يسجّل `FAWRY_REFERENCE` صح في `order_status_history`/`audit_logs`.

**اتعمله تحقق حي جزئي** (مفيش إنترنت خارجي هنا لنداء sandbox FawryPay الحقيقي، نفس قيد Paymob بالظبط): `pay-with-fawry-reference` على طلب حقيقي `work_completed` نادى الـ gateway الحقيقي فعلاً ورجع `PAY_001` بوضوح (البوابة مش مُعدّة — نفس السلوك المتوقع من غير مفاتيح). بعدين، باستخدام مفاتيح اختبار مؤقتة ومحاكاة webhook موقّع يدوياً بنفس خوارزمية `computeWebhookSignature`: طلب حقيقي اتقفل `completed`/`paid` صح، قيد `wallet_transactions` مزدوج ظهر صح (255 جنيه فني/عمولة منصة)، إعادة إرسال **نفس** الـ webhook اتجاهلت تماماً (idempotency)، وتوقيع غلط اترفض بوضوح ("توقيع غير صحيح — الحدث اتجاهل"). ده بيأكد إن **كل حاجة غير مرتبطة مباشرة بشكل رد FawryPay الحقيقي** (idempotency، التسوية، القيد المزدوج، رفض التوقيع، تجاهل التكرار) شغالة صح 100%. اللي **لسه محتاج تحقق** هو تحديداً ترتيب حقول التوقيع نفسه مقابل التوثيق الرسمي وقت التفعيل الحقيقي — موثّق بالتفصيل في `docs/03-external-integrations.md`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.

## أمان الـtransaction الموزّعة في refundOrder() — بَقّة حقيقية اتصلحت (docs/08 §19 بند 4)

كان `provider.refund()` (نداء HTTP خارجي حقيقي للبوابة) بينفّذ **جوّه** نفس DB transaction اللي
بتسجّل صف الـ`Refund`/تحدّث المحافظ/تقفل الطلب. لو نجح فعليًا عند البوابة وبعده خطوة تانية جوّه
نفس الـtransaction فشلت (DB error عابر مثلاً)، Postgres يعمل rollback كامل — لكن الفلوس فعليًا
اترجعت للعميل عند البوابة، ونظامنا مش عارف. Retry لاحق كان ممكن يعمل استرداد مزدوج حقيقي.

**الإصلاح**: `refundOrder()` بقت 3 مراحل منفصلة:
1. **(أ) DB transaction قصيرة** — تحقق + قفل (`pessimistic_write` على الطلب) + تسجيل صف `Refund`
   بحالة `PROCESSING` **قبل** أي نداء خارجي. `idx_refunds_payment_id_unique` (ADR-0013 §9) بيضمن
   صف واحد بس لكل دفعة، فأي محاولة تانية (متزامنة أو retry) هتلاقي الصف ده وترفض فورًا.
2. **(ب) النداء الخارجي نفسه** — برّه أي transaction تمامًا.
3. **(ج) DB transaction قصيرة تانية منفصلة** — بعد ما نتيجة البوابة بقت معروفة فعليًا، تسجيل
   النتيجة (`COMPLETED`/`REJECTED`) + تأثيرات المحافظ + تحديث حالة الطلب/الدفعة.

لو الـprocess وقع بعد نجاح فعلي عند البوابة وقبل المرحلة (ج)، صف الـ`Refund` يفضل `PROCESSING`
(مش ضايع، ومش rollback) — أي محاولة استرداد تانية لنفس الدفعة بترفض فورًا برسالة واضحة، بدل ما
تنادي البوابة تاني. **حل هذه الحالة العالقة نفسها محتاج مراجعة يدوية عبر `provider.reconcile()`
الموجودة بالفعل** — ده فجوة تشغيلية موثّقة صراحة (مش auto-reconciliation sweep كامل)، خارج نطاق
هذا الإصلاح المحدّد.

**اتأكد حي بالكامل** (`refund-transaction-safety.spec.ts`، 4 اختبارات ضد Postgres حقيقي، provider
مزيّف بيتحقق فعليًا من DB state قبل ما ينفّذ):
- استرداد ناجح: صف `Refund` مؤكَّد `PROCESSING` (committed) **قبل** نداء البوابة، وبعده بيترحّل
  لـ`COMPLETED` مع `providerRefundId`، الطلب/الدفعة يترحّلوا صح.
- البوابة رفضت صراحة: الصف يترحّل `REJECTED`، الطلب يفضل زي ما هو (مفيش تأثير مالي كاذب).
- نداء البوابة رمى استثناء (محاكاة انقطاع شبكة): الصف يفضل `PROCESSING` (مش ضايع)، الطلب يفضل
  `PAID`، ومحاولة استرداد تانية فورية بترفض بـ409 واضح — الثغرة الأصلية اتقفلت.
- محاولة استرداد تانية بعد رفض أول: بترفض برضه (منع تكرار محاولات على نفس الدفعة).

## `refundSystemCancelledOrder()` — استرداد فوري لإلغاء نظامي قبل التوزيع (docs/08 §19 بند 3+5)

بينادى من `OrderAutoCancelService` (`../orders/order-auto-cancel.service.ts`) لما طلب
`SEARCHING_TECHNICIAN` مدفوع مسبقًا (كارت/InstaPay) يتلغى تلقائيًا لعدم توفر فني. **مختلف عمدًا
عن `refundOrder()` فوق**: هناك الطلب لازم `COMPLETED`/`DISPUTED` عشان ينتقل لـ`REFUNDED` نهائية
(استرداد بعد خدمة/نزاع). هنا الطلب **بالفعل** `CANCELLED_BY_SYSTEM` — الحالة الصح اللي تحكي قصته
الحقيقية (اتلغى، مش اتسلّم واترجعت فلوسه) — فمفيش انتقال `orderStatus` تاني (`ORDER_TRANSITIONS`
مفيهاش `CANCELLED_BY_SYSTEM → REFUNDED` عمدًا)، بس `paymentStatus` بيتسجّل `REFUNDED`. نفس نمط
أمان الـ3 مراحل بتاع `refundOrder()` بالظبط ولنفس السبب (نداء بوابة خارجي حقيقي). مفيش عكس أرباح
فني (الفحص الدوري بيستهدف طلبات `technicianId=null` بالتعريف). Idempotent — بترجع `null` بهدوء
لو مفيش دفعة ناجحة أو فيه `Refund` مسجّل بالفعل، بدل ما ترمي استثناء يوقف بقية الفحص الدوري.

اتأكد حي في `../orders/order-auto-cancel-pending-payment.spec.ts` — تفاصيل في `../orders/README.md`.

`tsc --noEmit`/`nest build`/الـ133 اختبار (23 suite) عدّوا نضيف — صفر تغيير سلوكي في المسارات
اللي مش بتعدّي على بوابة حقيقية (كاش/محفظة/InstaPay/فوري، `WALLET_CREDIT` fallback زي ما هو).

## تسوية الطلب المدفوع مسبقًا + الدفع الإضافي (ADR-0015) — بَقّة حرجة اتصلحت + بند 2 من docs/08 §19

**البَقّة (اتأكدت حيًا بشكل قاطع قبل الإصلاح)**: أي طلب مدفوع مسبقًا (كارت/InstaPay قبل التوزيع،
ADR-0013) كان بيفضل عالق في `WORK_COMPLETED` للأبد بمجرد ما الفني يخلّص الشغل. السبب:
`assertPayable()` كانت بترفض أي تسوية (`collectCash`/`payWithWallet`/`payWithProvider`) لمجرد إن
`paymentStatus === PAID` — وده صحيح من لحظة تأكيد الدفع المسبق، **قبل ما الفني يوصل حتى**، مش بعد
اكتمال الشغل. طلب `work_completed`/`paid`/`card` حقيقي في Postgres جُرّب عليه `collectCash()`
مباشرة ورجع `"الطلب مدفوع بالفعل"` — الفني ماياخدش أرباحه، الطلب مايوصلش `COMPLETED`، مفيش
تقييم/ضمان/إغلاق شات تلقائي. تفاصيل الاكتشاف الكاملة في `docs/adr/0015-prepaid-order-settlement-and-additional-payment.md`.

**الحل — 3 قطع مترابطة**:
1. **`AWAITING_PAYMENT` اتفعّلت** (كانت في `order-state-machine.ts` من أول يوم بلا استخدام) —
   معناها الجديد: "الشغل خلص، فيه دلتا (مبلغ إضافي بعد بند اتوافق عليه بعد الدفع المسبق) لسه
   مستنية تحصيل".
2. **`PrepaidOrderSettlementListener` جديد** — بيسمع `ORDER_STATUS_CHANGED_EVENT` (نفس نمط
   `ScheduleSlotReleaseListener`)، ولو `newStatus=WORK_COMPLETED` وطلب مدفوع مسبقًا، بينادي
   `PaymentsService.settleAlreadyPaidOrder(orderId)`: دلتا=صفر → تسوية تلقائية فورية بلا أي تدخل
   (الطلب يقفل صح زي ما كان المفروض من الأول)؛ دلتا>صفر → انتقال `AWAITING_PAYMENT` بس، مفيش
   توزيع أرباح لسه.
3. **`assertPayable()` بقت تميّز**: `paymentStatus=PAID` مرفوضة **إلا** لو `orderStatus=AWAITING_PAYMENT`
   تحديدًا — الحالة الوحيدة اللي فيها "مدفوع جزئيًا، لسه فيه باقي" ممكنة. `amountOwedNow(order)`
   جديدة بترجع الدلتا بس (مش الإجمالي الكامل) للحالة دي، والثلاث دوال العامة (`collectCash`/
   `payWithWallet`/`payWithProvider`) بتستخدمها بدل `order.totalAmountCents` الخام — **مفيش
   endpoint جديد خالص**، نفس الأزرار الموجودة (دفع كارت/InstaPay/كاش/محفظة) بتشتغل صح تلقائيًا
   للحالتين. تحقق مبلغ الـwebhook (P0-7) بيتحقق صح تلقائيًا ضد الدلتا برضه — بيقارن `payment.amountCents`
   (اللي بقى الدلتا) مش `order.totalAmountCents`.

**اتأكد حي بالكامل** (`prepaid-order-settlement.spec.ts`، 3 اختبارات، حساب عمولة حقيقي دقيق):
دلتا=صفر → تسوية فورية، `COMPLETED`، عمولة 10% محسوبة صح، أرباح الفني اتحوّلت فعليًا لمحفظته
(اتأكد بالرصيد الفعلي)، مفيش صف `Payment` جديد. دلتا>صفر → `AWAITING_PAYMENT` (idempotent —
نداء تاني ماغيّرش حاجة)، `collectCash()` بعدها حصّل الدلتا بس (مش الإجمالي)، وبعد التحصيل
`COMPLETED` بعمولة محسوبة من الإجمالي **الكامل** النهائي صح، ومحاولة تحصيل تالتة اترفضت (منع
تحصيل مزدوج). طلب عادي (مش مدفوع مسبقًا) في `WORK_COMPLETED` — `settleAlreadyPaidOrder()` لا
تفعل شيء خالص (regression، المسار العادي فضل زي زمان بالحرف). + `prepaid-order-settlement.listener.spec.ts`
(3 اختبارات وحدة نقية) للـlistener نفسه.

**فجوة موثّقة صراحة، خارج نطاق هذا الإصلاح**: تصميم UI جديد في `apps/customer-app` (Flutter)
لشاشة "ادفع المبلغ الإضافي" مش جزء من هذا التغيير — العميل هيشوف الفرق كـ"دفعة جديدة" في نفس
شاشات الدفع الموجودة أصلاً حاليًا.
